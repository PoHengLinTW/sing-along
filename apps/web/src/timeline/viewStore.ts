import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_PX_PER_SEC } from './math';

export interface ViewState {
  pxPerSec: number;
  /** Auto-follow the playhead while playing. Turned off when the user scrolls away. */
  follow: boolean;
}

export const createViewStore = () =>
  createStore<ViewState>(() => ({ pxPerSec: DEFAULT_PX_PER_SEC, follow: true }));
export const viewStore = createViewStore();
export const useView = <T>(selector: (s: ViewState) => T): T => useStore(viewStore, selector);
