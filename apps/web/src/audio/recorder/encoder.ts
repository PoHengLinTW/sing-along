import type { StoreApi } from 'zustand/vanilla';
import type { Draft, DraftStore } from './draftStore';
import { encodeInWorker } from './encode/client';
import { type EncodeFn, finalizeDraft } from './encode/finalize';
import { type EncodeState, encodeStore } from './encodeStore';
import { getDraftStore } from './storeInstance';

interface Deps {
  getStore: () => Promise<DraftStore>;
  encode: EncodeFn;
  state: StoreApi<EncodeState>;
  onReady?: (draft: Draft) => void;
}

export const WAV_NOTICE =
  'The FLAC encoder could not load, so this take was saved as WAV instead. It works the same but the file is about twice as large.';

/** Runs the encode step for drafts, one at a time per draft, and reports progress and failures. */
export class DraftEncoder {
  private running = new Map<string, Promise<void>>();

  constructor(private deps: Deps) {}

  encode(draftId: string): Promise<void> {
    const existing = this.running.get(draftId);
    if (existing) return existing;
    const job = this.run(draftId).finally(() => this.running.delete(draftId));
    this.running.set(draftId, job);
    return job;
  }

  private async run(draftId: string): Promise<void> {
    const { state } = this.deps;
    state.getState().start(draftId);
    try {
      const store = await this.deps.getStore();
      const { draft, fellBack } = await finalizeDraft(store, draftId, this.deps.encode, (f) =>
        state.getState().progress(draftId, f),
      );
      state.getState().done(draftId);
      if (fellBack) state.getState().setNotice(WAV_NOTICE);
      this.deps.onReady?.(draft);
    } catch (err) {
      state.getState().fail(draftId, (err as Error).message);
    }
  }
}

let shared: DraftEncoder | null = null;
export function getDraftEncoder(): DraftEncoder {
  shared ??= new DraftEncoder({
    getStore: getDraftStore,
    encode: encodeInWorker,
    state: encodeStore,
  });
  return shared;
}
