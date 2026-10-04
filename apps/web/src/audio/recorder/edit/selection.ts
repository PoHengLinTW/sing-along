import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface SelectionState {
  /** Ids of the takes chosen for editing, in the order they were picked. */
  ids: string[];
  toggle(id: string): void;
  clear(): void;
  /** Forget takes that no longer exist (discarded, uploaded, merged away). */
  prune(existing: string[]): void;
}

export const createSelectionStore = () =>
  createStore<SelectionState>((set, get) => ({
    ids: [],
    toggle: (id) =>
      set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] })),
    clear: () => set((s) => (s.ids.length ? { ids: [] } : s)),
    prune: (existing) => {
      const kept = get().ids.filter((id) => existing.includes(id));
      if (kept.length !== get().ids.length) set({ ids: kept });
    },
  }));

export const selectionStore = createSelectionStore();
export const useSelection = <T>(selector: (s: SelectionState) => T): T =>
  useStore(selectionStore, selector);
