import { useEffect } from 'react';
import { viewStore } from '../timeline/viewStore';
import { mixerStore } from './mixerStore';
import { type KeyValueStorage, loadMix, pruneMix, saveMix } from './mixPersistence';

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // access itself can throw when site data is blocked
  }
}

/**
 * Per-browser mix memory for one project: restores volume/mute/solo and zoom on entry, saves every
 * change, and forgets tracks that were deleted. Uses localStorage only; nothing goes to the server.
 */
export function useMixPersistence(
  projectId: number | undefined,
  trackIds: number[] | undefined,
): void {
  useEffect(() => {
    if (projectId === undefined || Number.isNaN(projectId)) return;
    const storage = browserStorage();
    const saved = loadMix(storage, projectId);
    mixerStore.setState({ byId: saved.byId });
    if (saved.pxPerSec !== null) viewStore.setState({ pxPerSec: saved.pxPerSec });

    const persist = () =>
      saveMix(storage, projectId, {
        byId: mixerStore.getState().byId,
        pxPerSec: viewStore.getState().pxPerSec,
      });
    const stopMixer = mixerStore.subscribe(persist);
    const stopView = viewStore.subscribe((s, prev) => {
      if (s.pxPerSec !== prev.pxPerSec) persist();
    });
    return () => {
      stopMixer();
      stopView();
      mixerStore.getState().reset(); // the store is global: don't leak this project's ids into the next
    };
  }, [projectId]);

  const idsKey = trackIds?.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: idsKey stands for trackIds
  useEffect(() => {
    if (!trackIds) return;
    const current = mixerStore.getState().byId;
    const pruned = pruneMix(current, trackIds);
    if (pruned !== current) mixerStore.setState({ byId: pruned }); // subscribers persist the removal
  }, [idsKey]);
}
