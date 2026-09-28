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
      labels: [],
    });
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
