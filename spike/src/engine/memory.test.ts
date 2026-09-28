import { describe, expect, it } from 'vitest';
import { decodedBytes, maxTracksWithin } from './memory';

describe('decodedBytes', () => {
  it('is duration x rate x channels x 4 bytes (Float32)', () => {
    expect(decodedBytes({ durationSec: 240, sampleRate: 44100, channels: 1 })).toBe(240 * 44100 * 4);
    expect(decodedBytes({ durationSec: 240, sampleRate: 48000, channels: 2 })).toBe(240 * 48000 * 2 * 4);
  });
});

describe('maxTracksWithin', () => {
  it('counts how many equal tracks fit in a budget', () => {
    const t = { durationSec: 240, sampleRate: 48000, channels: 1 };
    expect(maxTracksWithin(t, decodedBytes(t) * 3.5)).toBe(3);
  });
});
