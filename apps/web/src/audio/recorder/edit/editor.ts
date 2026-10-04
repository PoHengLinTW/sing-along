import { getAudioController } from '../../controller';
import { latencyStore } from '../../latency';
import type { Draft, DraftStore } from '../draftStore';
import { draftEngineId } from '../draftView';
import { encodeInWorker } from '../encode/client';
import type { EncodedTake, EncodeInput } from '../encode/encode';
import { getDraftStore } from '../storeInstance';
import { type EditEntry, type EditHistory, editHistory } from './history';
import { combinePieces, cutPiece, type Piece, trimAfter, trimBefore } from './ops';

export type EditResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'outside' | 'overlap' | 'too-few' | 'sample-rate' | 'busy' | 'failed' | 'not-ready';
      overlapMs?: number;
    };

interface Deps {
  getStore: () => Promise<DraftStore>;
  history: EditHistory;
  decode: (blob: Blob) => Promise<{ samples: Float32Array; sampleRate: number }>;
  encode: (input: EncodeInput) => Promise<EncodedTake>;
}

const startOf = (d: Draft) => d.startOffsetMs + d.latencyOffsetMs;

/**
 * Edits to local drafts: split, trim and combine. Each edit decodes the take, changes the audio,
 * encodes it again and writes the result, so a draft is always one ordinary playable file and
 * the upload sends exactly what was heard. Every edit is one undo step.
 */
export class DraftEditor {
  private working = false;

  constructor(private deps: Deps) {}

  get history(): EditHistory {
    return this.deps.history;
  }

  split(draftId: string, tMs: number): Promise<EditResult> {
    return this.run(async (store) => {
      const draft = await this.readyDraft(store, draftId);
      if (!draft) return { ok: false, reason: 'not-ready' };
      const parts = cutPiece(await this.pieceOf(draft), tMs);
      if (!parts) return { ok: false, reason: 'outside' };
      const [a, b] = await Promise.all(parts.map((p) => this.encoded(p)));
      const first = this.withAudio(draft, parts[0], a as EncodedTake);
      const second: Draft = {
        ...this.withAudio(draft, parts[1], b as EncodedTake),
        id: crypto.randomUUID(),
        name: `${draft.name} (2)`,
        createdAt: await this.createdAfter(store, draft),
      };
      await this.commit(store, 'Split', [draft], [first, second]);
      return { ok: true };
    });
  }

  trimBefore(draftId: string, tMs: number): Promise<EditResult> {
    return this.trim(draftId, tMs, trimBefore, 'Trim start');
  }

  trimAfter(draftId: string, tMs: number): Promise<EditResult> {
    return this.trim(draftId, tMs, trimAfter, 'Trim end');
  }

  /** Merges takes into the earliest one. Gaps become silence; overlaps are refused. */
  combine(draftIds: string[]): Promise<EditResult> {
    return this.run(async (store) => {
      if (draftIds.length < 2) return { ok: false, reason: 'too-few' };
      const drafts: Draft[] = [];
      for (const id of draftIds) {
        const d = await this.readyDraft(store, id);
        if (!d) return { ok: false, reason: 'not-ready' };
        drafts.push(d);
      }
      drafts.sort((a, b) => startOf(a) - startOf(b));
      const merged = combinePieces(await Promise.all(drafts.map((d) => this.pieceOf(d))));
      if ('error' in merged) {
        return merged.error === 'overlap'
          ? { ok: false, reason: 'overlap', overlapMs: merged.overlapMs }
          : { ok: false, reason: merged.error };
      }
      const result = this.withAudio(
        drafts[0] as Draft,
        merged.piece,
        await this.encoded(merged.piece),
      );
      await this.commit(store, 'Combine', drafts, [result]);
      return { ok: true };
    });
  }

  async undo(): Promise<boolean> {
    const entry = this.deps.history.undo();
    if (!entry) return false;
    await this.restore(entry.after, entry.before);
    return true;
  }

  async redo(): Promise<boolean> {
    const entry = this.deps.history.redo();
    if (!entry) return false;
    await this.restore(entry.before, entry.after);
    return true;
  }

  private async restore(from: Draft[], to: Draft[]): Promise<void> {
    const store = await this.deps.getStore();
    const keep = new Set(to.map((d) => d.id));
    await store.replaceDrafts(
      from.filter((d) => !keep.has(d.id)).map((d) => d.id),
      to,
    );
  }

  private trim(
    draftId: string,
    tMs: number,
    op: (p: Piece, t: number) => Piece | null,
    label: string,
  ): Promise<EditResult> {
    return this.run(async (store) => {
      const draft = await this.readyDraft(store, draftId);
      if (!draft) return { ok: false, reason: 'not-ready' };
      const piece = op(await this.pieceOf(draft), tMs);
      if (!piece) return { ok: false, reason: 'outside' };
      const next = this.withAudio(draft, piece, await this.encoded(piece));
      await this.commit(store, label, [draft], [next]);
      return { ok: true };
    });
  }

  /** One edit at a time; a failure leaves every take as it was. */
  private async run(job: (store: DraftStore) => Promise<EditResult>): Promise<EditResult> {
    if (this.working) return { ok: false, reason: 'busy' };
    this.working = true;
    try {
      return await job(await this.deps.getStore());
    } catch {
      return { ok: false, reason: 'failed' };
    } finally {
      this.working = false;
    }
  }

  /**
   * The take as the user sees it: a Start time edit still waiting for its save counts, otherwise
   * an edit made half a second after a move would work from the old position.
   */
  private async readyDraft(store: DraftStore, id: string): Promise<Draft | null> {
    const d = await store.getDraft(id);
    if (d?.status !== 'ready' || !d.blob) return null;
    const pending = latencyStore.getState().byId[draftEngineId(id)];
    return pending === undefined ? d : { ...d, latencyOffsetMs: pending };
  }

  private async pieceOf(d: Draft): Promise<Piece> {
    const { samples, sampleRate } = await this.deps.decode(d.blob as Blob);
    return { samples, sampleRate, startMs: startOf(d) };
  }

  private encoded(p: Piece): Promise<EncodedTake> {
    return this.deps.encode({ samples: p.samples, sampleRate: p.sampleRate, trimSamples: 0 });
  }

  private withAudio(base: Draft, piece: Piece, enc: EncodedTake): Draft {
    return {
      ...base,
      latencyOffsetMs: Math.round(piece.startMs) - base.startOffsetMs,
      sampleRate: piece.sampleRate,
      blob: new Blob([enc.bytes as BlobPart], { type: enc.mimeType }),
      mimeType: enc.mimeType,
      peaks: enc.peaks,
      durationMs: enc.durationMs,
    };
  }

  /** Between the draft and the next one, so the new take lists right after it. */
  private async createdAfter(store: DraftStore, d: Draft): Promise<number> {
    const later = (await store.listDrafts(d.projectId)).find((x) => x.createdAt > d.createdAt);
    return later ? (d.createdAt + later.createdAt) / 2 : d.createdAt + 1;
  }

  private async commit(
    store: DraftStore,
    label: string,
    before: Draft[],
    after: Draft[],
  ): Promise<void> {
    const keep = new Set(after.map((d) => d.id));
    await store.replaceDrafts(
      before.filter((d) => !keep.has(d.id)).map((d) => d.id),
      after,
    );
    // The results carry the on-screen start times, so the pending copies have done their job.
    latencyStore.getState().drop([...before, ...after].map((d) => draftEngineId(d.id)));
    this.deps.history.push({ label, before, after } satisfies EditEntry);
  }
}

let shared: DraftEditor | null = null;
export function getDraftEditor(): DraftEditor {
  shared ??= new DraftEditor({
    getStore: getDraftStore,
    history: editHistory,
    decode: async (blob) => {
      const buffer = await getAudioController().engine.decode(await blob.arrayBuffer());
      return { samples: buffer.getChannelData(0).slice(), sampleRate: buffer.sampleRate };
    },
    encode: (input) => encodeInWorker(input),
  });
  return shared;
}
