import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyLatency,
  clampLatency,
  convergedIds,
  createLatencyStore,
  LATENCY_MAX_MS,
} from './latency';

describe('clampLatency', () => {
  it('rounds to whole ms and limits to +-1000', () => {
    expect(clampLatency(12.6)).toBe(13);
    expect(clampLatency(5000)).toBe(LATENCY_MAX_MS);
    expect(clampLatency(-5000)).toBe(-LATENCY_MAX_MS);
    expect(clampLatency(Number.NaN)).toBe(0);
  });
});

describe('applyLatency', () => {
  const items = [
    { id: 1, latencyOffsetMs: 0, name: 'a' },
    { id: 2, latencyOffsetMs: 30, name: 'b' },
  ];

  it('replaces the latency of items that have a pending value, keeping the rest untouched', () => {
    const out = applyLatency(items, (i) => i.id, { 2: -40 });
    expect(out[0]).toBe(items[0]); // same object: no needless re-render
    expect(out[1]).toEqual({ id: 2, latencyOffsetMs: -40, name: 'b' });
  });

  it('returns the same array when there is nothing to apply', () => {
    expect(applyLatency(items, (i) => i.id, {})).toBe(items);
  });
});

describe('convergedIds', () => {
  it('lists overrides that the saved data now agrees with, so they can be dropped', () => {
    const items = [
      { id: 1, latencyOffsetMs: 10 },
      { id: 2, latencyOffsetMs: 0 },
    ];
    expect(convergedIds(items, (i) => i.id, { 1: 10, 2: 25, 3: 5 })).toEqual([1]);
  });
});

describe('latency store', () => {
  let store: ReturnType<typeof createLatencyStore>;
  beforeEach(() => {
    store = createLatencyStore();
  });

  it('sets a clamped pending value and drops values', () => {
    store.getState().set(4, 99999);
    expect(store.getState().byId[4]).toBe(LATENCY_MAX_MS);
    store.getState().drop([4, 7]);
    expect(store.getState().byId).toEqual({});
  });
});
