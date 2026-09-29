import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface TransportState {
  playing: boolean;
  /** Seconds. Written every animation frame while playing: subscribe with a selector. */
  position: number;
  duration: number;
}

export const createTransportStore = () =>
  createStore<TransportState>(() => ({ playing: false, position: 0, duration: 0 }));

export const transportStore = createTransportStore();

/** Components select only what they render, so a 60 Hz position update re-renders only the position readers. */
export function useTransport<T>(selector: (s: TransportState) => T): T {
  return useStore(transportStore, selector);
}
