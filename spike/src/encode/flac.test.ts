import { describe, expect, it } from 'vitest';
import { encodeFlac } from './flac';
import { floatToInt16 } from './pcm';
import { decodeFlacToInt16 } from './flac-decode-test-helper';

function tone(seconds: number, sampleRate: number): Float32Array {
  const n = Math.round(seconds * sampleRate);
  return Float32Array.from({ length: n }, (_, i) => 0.6 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
}

describe('encodeFlac', () => {
  it('produces a FLAC stream that round-trips losslessly at 16-bit mono', async () => {
    const src = tone(1, 48000);
    const flac = await encodeFlac(src, 48000);
    expect(String.fromCharCode(...flac.subarray(0, 4))).toBe('fLaC');
    const decoded = await decodeFlacToInt16(flac);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.samples.subarray(0, 2000))).toEqual(Array.from(floatToInt16(src).subarray(0, 2000)));
    expect(decoded.samples.length).toBe(src.length);
  });
  it('is smaller than the WAV equivalent', async () => {
    const src = tone(2, 44100);
    const flac = await encodeFlac(src, 44100);
    expect(flac.length).toBeLessThan(src.length * 2);
  });
});
