import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface TrackMix {
  volume: number; // 0..1.5 (100% = 1)
  muted: boolean;
  solo: boolean;
}

export const DEFAULT_MIX: TrackMix = { volume: 1, muted: false, solo: false };
export const MAX_VOLUME = 1.5;

export interface MixerState {
  byId: Record<number, TrackMix>;
  get(id: number): TrackMix;
  setVolume(id: number, volume: number): void;
  toggleMute(id: number): void;
  setMuted(id: number, muted: boolean): void;
  toggleSolo(id: number): void;
  /** Drop a deleted track's state. */
  forget(id: number): void;
  reset(): void;
}

/** Per-browser mix (volume / mute / solo). Never sent to the server. Persistence is added in M1-17. */
export const createMixerStore = () =>
  createStore<MixerState>((set, get) => {
    const patch = (id: number, p: Partial<TrackMix>) =>
      set((s) => ({ byId: { ...s.byId, [id]: { ...(s.byId[id] ?? DEFAULT_MIX), ...p } } }));
    return {
      byId: {},
      get: (id) => get().byId[id] ?? DEFAULT_MIX,
      setVolume: (id, volume) => patch(id, { volume: Math.min(MAX_VOLUME, Math.max(0, volume)) }),
      toggleMute: (id) => patch(id, { muted: !get().get(id).muted }),
      setMuted: (id, muted) => patch(id, { muted }),
      toggleSolo: (id) => patch(id, { solo: !get().get(id).solo }),
      forget: (id) =>
        set((s) => {
          const byId = { ...s.byId };
          delete byId[id];
          return { byId };
        }),
      reset: () => set({ byId: {} }),
    };
  });

export const mixerStore = createMixerStore();
export const useMix = (id: number): TrackMix =>
  useStore(mixerStore, (s) => s.byId[id] ?? DEFAULT_MIX);
