import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { blockPeak, type LevelBlock, type LevelState, updateLevel } from './level';

export interface LevelStoreState extends LevelState {
  /** Input check is on (the mic is open without a take). */
  monitoring: boolean;
  /** The microphone is muted during an input check (a take's mute lives in the recording store). */
  muted: boolean;
}

export const createLevelStore = () =>
  createStore<LevelStoreState>(() => ({ level: 0, clipUntil: 0, monitoring: false, muted: false }));
export const levelStore = createLevelStore();
export const useLevels = <T>(selector: (s: LevelStoreState) => T): T =>
  useStore(levelStore, selector);

export function feedLevel(
  store: ReturnType<typeof createLevelStore>,
  block: LevelBlock,
  nowMs: number = Date.now(),
): void {
  store.setState(updateLevel(store.getState(), blockPeak(block), nowMs));
}

/** The mic is closed: the bar drops to empty, any clip warning is dropped, the mute is undone. */
export function clearLevel(store: ReturnType<typeof createLevelStore>): void {
  store.setState({ level: 0, clipUntil: 0, muted: false });
}
