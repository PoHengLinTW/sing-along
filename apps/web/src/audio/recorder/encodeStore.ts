import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface EncodeEntry {
  fraction: number;
  error?: string;
}

export interface EncodeState {
  byId: Record<string, EncodeEntry>;
  /** Shown once, e.g. when the WAV fallback was used. */
  notice: string | null;
  start(id: string): void;
  progress(id: string, fraction: number): void;
  fail(id: string, message: string): void;
  done(id: string): void;
  setNotice(notice: string | null): void;
}

export const createEncodeStore = () =>
  createStore<EncodeState>((set) => ({
    byId: {},
    notice: null,
    start: (id) => set((s) => ({ byId: { ...s.byId, [id]: { fraction: 0 } } })),
    progress: (id, fraction) => set((s) => ({ byId: { ...s.byId, [id]: { fraction } } })),
    fail: (id, error) => set((s) => ({ byId: { ...s.byId, [id]: { fraction: 0, error } } })),
    done: (id) =>
      set((s) => {
        const { [id]: _gone, ...rest } = s.byId;
        return { byId: rest };
      }),
    setNotice: (notice) => set({ notice }),
  }));

export const encodeStore = createEncodeStore();
export const useEncodeState = <T>(selector: (s: EncodeState) => T): T =>
  useStore(encodeStore, selector);
