import { beforeEach, describe, expect, it } from 'vitest';
import { loadMix, mixKey, parseMix, pruneMix, saveMix } from './mixPersistence';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

describe('mixKey', () => {
  it('is per project', () => {
    expect(mixKey(7)).toBe('sing-along:mix:7');
    expect(mixKey(7)).not.toBe(mixKey(8));
  });
});

describe('parseMix', () => {
  it('reads a saved mix and zoom', () => {
    const json = JSON.stringify({
      byId: { 1: { volume: 0.5, muted: true, solo: false } },
      pxPerSec: 80,
    });
    expect(parseMix(json)).toEqual({
      byId: { 1: { volume: 0.5, muted: true, solo: false } },
      pxPerSec: 80,
    });
  });
  it('falls back to defaults for missing, empty or corrupt data', () => {
    for (const bad of [null, '', 'not json', '{"byId": 5}', '[]', 'null']) {
      expect(parseMix(bad)).toEqual({ byId: {}, pxPerSec: null });
    }
  });
  it('sanitizes values: clamps volume, coerces flags, drops nonsense entries and bad zoom', () => {
    const json = JSON.stringify({
      byId: {
        1: { volume: 9, muted: 'yes', solo: true },
        2: { volume: -3 },
        3: 'oops',
        x: { volume: 1 },
      },
      pxPerSec: 'wide',
    });
    expect(parseMix(json)).toEqual({
      byId: {
        1: { volume: 1.5, muted: false, solo: true },
        2: { volume: 0, muted: false, solo: false },
      },
      pxPerSec: null,
    });
  });
  it('keeps a zoom within the allowed range', () => {
    expect(parseMix(JSON.stringify({ byId: {}, pxPerSec: 99999 })).pxPerSec).toBe(800);
    expect(parseMix(JSON.stringify({ byId: {}, pxPerSec: 0.1 })).pxPerSec).toBe(2);
  });
});

describe('pruneMix', () => {
  it('drops state for tracks that no longer exist and keeps the rest', () => {
    const byId = {
      1: { volume: 0.5, muted: false, solo: false },
      2: { volume: 1, muted: true, solo: false },
    };
    expect(pruneMix(byId, [2, 3])).toEqual({ 2: { volume: 1, muted: true, solo: false } });
  });
  it('returns the same object when nothing changes (no needless store update)', () => {
    const byId = { 1: { volume: 0.5, muted: false, solo: false } };
    expect(pruneMix(byId, [1])).toBe(byId);
  });
});

describe('saveMix / loadMix', () => {
  it('round-trips through storage, per project', () => {
    saveMix(storage, 7, { byId: { 1: { volume: 0.4, muted: true, solo: true } }, pxPerSec: 120 });
    saveMix(storage, 8, { byId: {}, pxPerSec: 10 });
    expect(loadMix(storage, 7)).toEqual({
      byId: { 1: { volume: 0.4, muted: true, solo: true } },
      pxPerSec: 120,
    });
    expect(loadMix(storage, 8).pxPerSec).toBe(10);
    expect(loadMix(storage, 9)).toEqual({ byId: {}, pxPerSec: null });
  });

  it('survives a storage that throws (private mode, quota, blocked)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(() => saveMix(broken, 7, { byId: {}, pxPerSec: 50 })).not.toThrow();
    expect(loadMix(broken, 7)).toEqual({ byId: {}, pxPerSec: null });
    expect(loadMix(null, 7)).toEqual({ byId: {}, pxPerSec: null });
  });
});
