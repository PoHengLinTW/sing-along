import { describe, expect, it } from 'vitest';
import type { Draft } from './draftStore';
import { draftEngineId, toDraftView } from './draftView';

const base: Draft = {
  id: '3f2b8c1e-aaaa-bbbb-cccc-000000000001',
  projectId: 1,
  startOffsetMs: 1500,
  latencyOffsetMs: -40,
  sampleRate: 48000,
  createdAt: 1,
  status: 'ready',
  name: 'Take 1',
  performer: 'Ann',
  blob: new Blob([new Uint8Array(3)], { type: 'audio/flac' }),
  mimeType: 'audio/flac',
  peaks: [0.1, 0.5],
  durationMs: 2000,
};

describe('draftEngineId', () => {
  it('is a negative integer, so it can never clash with a server track id', () => {
    for (const id of ['a', 'b', base.id, crypto.randomUUID()]) {
      const n = draftEngineId(id);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeLessThan(0);
    }
  });

  it('is stable across calls and differs between drafts', () => {
    expect(draftEngineId(base.id)).toBe(draftEngineId(base.id));
    const ids = new Set(Array.from({ length: 200 }, () => draftEngineId(crypto.randomUUID())));
    expect(ids.size).toBe(200);
  });
});

describe('toDraftView', () => {
  it('describes a ready draft for the timeline and the engine', () => {
    expect(toDraftView(base)).toMatchObject({
      id: base.id,
      engineId: draftEngineId(base.id),
      name: 'Take 1',
      performer: 'Ann',
      startOffsetMs: 1500,
      latencyOffsetMs: -40,
      durationMs: 2000,
      peaks: [0.1, 0.5],
    });
  });

  it('is null until the take is encoded', () => {
    expect(toDraftView({ ...base, status: 'encoding' })).toBeNull();
    expect(toDraftView({ ...base, status: 'recording' })).toBeNull();
    expect(toDraftView({ ...base, blob: undefined })).toBeNull();
  });
});
