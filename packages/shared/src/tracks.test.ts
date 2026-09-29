import { describe, expect, it } from 'vitest';
import { extensionForMime, isAllowedAudioType, uploadUrlRequestSchema } from './index';

const valid = {
  name: 'Lead',
  performer: 'Sam',
  labels: [1, 2],
  mimeType: 'audio/flac',
  sizeBytes: 1234,
  durationMs: 5000,
  startOffsetMs: 0,
  source: 'upload' as const,
  peaks: [0, 0.5, 1],
};

describe('allowed audio types (PRD T1)', () => {
  it.each([
    ['audio/mpeg', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/x-m4a', 'm4a'],
    ['audio/aac', 'aac'],
    ['audio/wav', 'wav'],
    ['audio/x-wav', 'wav'],
    ['audio/ogg', 'ogg'],
    ['audio/webm', 'webm'],
    ['audio/flac', 'flac'],
  ])('%s -> .%s', (mime, ext) => {
    expect(isAllowedAudioType(mime)).toBe(true);
    expect(extensionForMime(mime)).toBe(ext);
  });

  it('ignores codec parameters and case', () => {
    expect(isAllowedAudioType('Audio/WebM;codecs=opus')).toBe(true);
    expect(extensionForMime('audio/webm; codecs=opus')).toBe('webm');
  });

  it('rejects other types', () => {
    expect(isAllowedAudioType('video/mp4')).toBe(false);
    expect(isAllowedAudioType('text/plain')).toBe(false);
    expect(extensionForMime('image/png')).toBeUndefined();
  });
});

describe('uploadUrlRequestSchema', () => {
  it('accepts a valid request and defaults the optional fields', () => {
    const { performer: _p, startOffsetMs: _s, labels: _l, ...min } = valid;
    expect(uploadUrlRequestSchema.parse(min)).toMatchObject({
      performer: null,
      startOffsetMs: 0,
      latencyOffsetMs: 0,
      labels: [],
    });
  });
  it('takes an optional latency offset, bounded to ±600000 ms like PATCH', () => {
    expect(uploadUrlRequestSchema.parse({ ...valid, latencyOffsetMs: -85 }).latencyOffsetMs).toBe(
      -85,
    );
    expect(uploadUrlRequestSchema.safeParse({ ...valid, latencyOffsetMs: 600001 }).success).toBe(
      false,
    );
    expect(uploadUrlRequestSchema.safeParse({ ...valid, latencyOffsetMs: 1.5 }).success).toBe(
      false,
    );
  });
  it('requires a name of 1-200 characters', () => {
    expect(uploadUrlRequestSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(uploadUrlRequestSchema.safeParse({ ...valid, name: 'a'.repeat(201) }).success).toBe(
      false,
    );
  });
  it('requires positive integer size and duration', () => {
    expect(uploadUrlRequestSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false);
    expect(uploadUrlRequestSchema.safeParse({ ...valid, durationMs: -1 }).success).toBe(false);
    expect(uploadUrlRequestSchema.safeParse({ ...valid, sizeBytes: 1.5 }).success).toBe(false);
  });
  it('bounds the start offset to ±600000 ms', () => {
    expect(uploadUrlRequestSchema.safeParse({ ...valid, startOffsetMs: 600000 }).success).toBe(
      true,
    );
    expect(uploadUrlRequestSchema.safeParse({ ...valid, startOffsetMs: 600001 }).success).toBe(
      false,
    );
  });
  it('rejects unknown sources and peaks outside 0..1', () => {
    expect(uploadUrlRequestSchema.safeParse({ ...valid, source: 'x' }).success).toBe(false);
    expect(uploadUrlRequestSchema.safeParse({ ...valid, peaks: [1.5] }).success).toBe(false);
  });
});

import { labelCreateSchema, trackOrderSchema, trackUpdateSchema } from './index';

describe('trackUpdateSchema', () => {
  it('is partial', () => {
    expect(trackUpdateSchema.parse({ name: ' New ' })).toEqual({ name: 'New' });
    expect(trackUpdateSchema.parse({})).toEqual({});
  });
  it('rejects an empty name', () => {
    expect(trackUpdateSchema.safeParse({ name: '' }).success).toBe(false);
  });
  it('accepts integer offsets within ±600000 ms only', () => {
    expect(trackUpdateSchema.safeParse({ latencyOffsetMs: -600000 }).success).toBe(true);
    expect(trackUpdateSchema.safeParse({ startOffsetMs: 600001 }).success).toBe(false);
    expect(trackUpdateSchema.safeParse({ latencyOffsetMs: 1.5 }).success).toBe(false);
  });
  it('accepts a label id set and an empty set', () => {
    expect(trackUpdateSchema.parse({ labels: [1, 2] })).toEqual({ labels: [1, 2] });
    expect(trackUpdateSchema.parse({ labels: [] })).toEqual({ labels: [] });
  });
});

describe('trackOrderSchema', () => {
  it('needs a list of positive integer ids', () => {
    expect(trackOrderSchema.parse({ trackIds: [3, 1, 2] })).toEqual({ trackIds: [3, 1, 2] });
    expect(trackOrderSchema.safeParse({ trackIds: [0] }).success).toBe(false);
    expect(trackOrderSchema.safeParse({}).success).toBe(false);
  });
});

describe('labelCreateSchema', () => {
  it('trims and enforces 1-30 characters', () => {
    expect(labelCreateSchema.parse({ name: '  Kazoo ' })).toEqual({ name: 'Kazoo' });
    expect(labelCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(labelCreateSchema.safeParse({ name: 'a'.repeat(31) }).success).toBe(false);
    expect(labelCreateSchema.safeParse({ name: 'a'.repeat(30) }).success).toBe(true);
  });
});
