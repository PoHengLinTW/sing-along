import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { LoopRegion } from './loop';

export interface TransportState {
  playing: boolean;
  /** Seconds. Written every animation frame while playing: subscribe with a selector. */
  position: number;
  duration: number;
  /** The A–B region, kept even while looping is switched off. */
  loop: LoopRegion | null;
  loopEnabled: boolean;
  /** "Set A" pressed but "Set B" not yet: a pending start marker. */
  loopA: number | null;
}

export const createTransportStore = () =>
  createStore<TransportState>(() => ({
    playing: false,
    position: 0,
    duration: 0,
    loop: null,
    loopEnabled: false,
    loopA: null,
  }));

export const transportStore = createTransportStore();

/** Components select only what they render, so a 60 Hz position update re-renders only the position readers. */
export function useTransport<T>(selector: (s: TransportState) => T): T {
  return useStore(transportStore, selector);
}
