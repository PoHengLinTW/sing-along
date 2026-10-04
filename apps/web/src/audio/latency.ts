import { OFFSET_MAX_MS } from '@sing-along/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Start times are edited anywhere on the timeline, so the stored offset spans the API's +-600 s. */
export const LATENCY_MAX_MS = OFFSET_MAX_MS;
/** How long the offset must stop changing before it is saved. */
export const LATENCY_SAVE_DELAY_MS = 500;

export function clampLatency(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-LATENCY_MAX_MS, Math.min(LATENCY_MAX_MS, Math.round(ms)));
}

interface LatencyState {
  /** Offsets the user has set but the saved data does not show yet, by engine id. */
  byId: Record<number, number>;
  set(id: number, ms: number): void;
  drop(ids: number[]): void;
}

/**
 * Offsets being edited. The waveform, the engine and the panels read the value from here at once;
 * the save (server PATCH or IndexedDB) follows after a quiet period.
 */
export const createLatencyStore = () =>
  createStore<LatencyState>((set) => ({
    byId: {},
    set: (id, ms) => set((s) => ({ byId: { ...s.byId, [id]: clampLatency(ms) } })),
    drop: (ids) =>
      set((s) => {
        if (!ids.some((id) => id in s.byId)) return s;
        const byId = { ...s.byId };
        for (const id of ids) delete byId[id];
        return { byId };
      }),
  }));

export const latencyStore = createLatencyStore();
export const useLatencyOverrides = () => useStore(latencyStore, (s) => s.byId);

/** Items with their pending latency applied. Untouched items keep their identity. */
export function applyLatency<T extends { latencyOffsetMs: number }>(
  items: T[],
  idOf: (item: T) => number,
  overrides: Record<number, number>,
): T[] {
  if (items.every((i) => overrides[idOf(i)] === undefined)) return items;
  return items.map((i) => {
    const v = overrides[idOf(i)];
    return v === undefined ? i : { ...i, latencyOffsetMs: v };
  });
}

/** Overrides the saved data has caught up with: they can be dropped. */
export function convergedIds<T extends { latencyOffsetMs: number }>(
  items: T[],
  idOf: (item: T) => number,
  overrides: Record<number, number>,
): number[] {
  return items.filter((i) => overrides[idOf(i)] === i.latencyOffsetMs).map(idOf);
}
