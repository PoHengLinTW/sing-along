import { useEffect, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { DraftStore } from './draftStore';
import { type DraftView, toDraftView } from './draftView';
import { getDraftEncoder } from './encoder';
import { type RecordingState, recordingStore } from './recordingStore';
import { getDraftStore } from './storeInstance';

interface Deps {
  getStore: () => Promise<DraftStore>;
  encode: (draftId: string) => Promise<void>;
  recording: StoreApi<RecordingState>;
}

const defaults = (): Deps => ({
  getStore: getDraftStore,
  encode: (id) => getDraftEncoder().encode(id),
  recording: recordingStore,
});

/**
 * The project's playable drafts, kept in step with IndexedDB. On entry it also finishes takes that
 * a crash or reload cut short (marks them `encoding`, starts the encoder), unless a take is being
 * recorded right now. If IndexedDB is unavailable the page simply has no drafts.
 */
export function useDrafts(
  projectId: number,
  deps?: Partial<Deps>,
): { drafts: DraftView[]; loaded: boolean } {
  const [drafts, setDrafts] = useState<DraftView[]>([]);
  const [loaded, setLoaded] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are injected in tests only
  useEffect(() => {
    const d = { ...defaults(), ...deps };
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setLoaded(false);
    (async () => {
      try {
        const store = await d.getStore();
        if (d.recording.getState().status === 'idle') {
          await store.recoverInterrupted(projectId);
          for (const draft of await store.listDrafts(projectId)) {
            if (draft.status === 'encoding') void d.encode(draft.id);
          }
        }
        const refresh = async () => {
          const list = await store.listDrafts(projectId);
          if (!cancelled) {
            setDrafts(list.map(toDraftView).filter((v): v is DraftView => v !== null));
          }
        };
        unsubscribe = store.subscribe(() => void refresh());
        await refresh();
      } catch {
        // IndexedDB blocked or broken: no drafts, the rest of the page still works.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [projectId]);

  return { drafts, loaded };
}
