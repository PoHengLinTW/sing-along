import { DEFAULT_CAPS } from '@sing-along/shared';
import { describe, expect, it } from 'vitest';
import { durationCapMessage, fileCapMessage } from './caps';

const MB = 1024 * 1024;

describe('fileCapMessage', () => {
  it('accepts a file at the limit', () => {
    expect(fileCapMessage({ name: 'a.flac', size: 60 * MB }, DEFAULT_CAPS)).toBeNull();
  });
  it('names the limit for a file one byte over', () => {
    expect(fileCapMessage({ name: 'a.flac', size: 60 * MB + 1 }, DEFAULT_CAPS)).toBe(
      'Too large (limit 60 MB).',
    );
  });
  it('adds the convert hint for WAV files', () => {
    expect(fileCapMessage({ name: 'Take.WAV', size: 61 * MB }, DEFAULT_CAPS)).toBe(
      'Too large (limit 60 MB). Convert to FLAC or MP3.',
    );
  });
  it('follows the live cap, not the default', () => {
    const caps = { ...DEFAULT_CAPS, maxFileBytes: 20 * MB };
    expect(fileCapMessage({ name: 'a.mp3', size: 21 * MB }, caps)).toContain('20 MB');
  });
});

describe('durationCapMessage', () => {
  it('accepts exactly 10 minutes', () => {
    expect(durationCapMessage(600_000, DEFAULT_CAPS)).toBeNull();
  });
  it('rejects just over, naming the limit', () => {
    expect(durationCapMessage(600_001, DEFAULT_CAPS)).toBe('Too long (limit 10 minutes).');
  });
});
