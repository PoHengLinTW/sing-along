import { describe, expect, it, vi } from 'vitest';
import { encodeTake } from './encode';

const tone = (sec: number, rate: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(sec * rate) },
    (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / rate),
  );

const okFlac = vi.fn(async (_s: Float32Array, _r: number, onProgress?: (f: number) => void) => {
  onProgress?.(0.5);
  onProgress?.(1);
  return Uint8Array.of(0x66, 0x4c, 0x61, 0x43); // 'fLaC'
});

describe('encodeTake', () => {
  it('encodes with FLAC and reports duration, peaks and MIME type', async () => {
    const r = await encodeTake(
      { samples: tone(2, 48000), sampleRate: 48000, trimSamples: 0 },
      { encodeFlac: okFlac },
    );
    expect(r.mimeType).toBe('audio/flac');
    expect(r.fellBack).toBe(false);
    expect(r.durationMs).toBe(2000);
    expect(r.peaks).toHaveLength(200); // 100 per second, like uploaded tracks
    expect(Math.max(...r.peaks)).toBeCloseTo(0.5, 1);
  });

  it('drops the samples that fall before timeline 0', async () => {
    const r = await encodeTake(
      { samples: tone(2, 48000), sampleRate: 48000, trimSamples: 4800 },
      { encodeFlac: okFlac },
    );
    expect(r.durationMs).toBe(1900);
    expect(okFlac.mock.calls.at(-1)?.[0].length).toBe(48000 * 2 - 4800);
  });

  it('falls back to a 16-bit mono WAV when the FLAC encoder cannot load', async () => {
    const broken = vi.fn(async () => {
      throw new Error('wasm failed to load');
    });
    const r = await encodeTake(
      { samples: tone(1, 44100), sampleRate: 44100, trimSamples: 0 },
      { encodeFlac: broken },
    );
    expect(r.fellBack).toBe(true);
    expect(r.mimeType).toBe('audio/wav');
    expect(String.fromCharCode(...r.bytes.subarray(0, 4))).toBe('RIFF');
    expect(r.bytes.length).toBe(44 + 44100 * 2);
    expect(r.durationMs).toBe(1000);
  });

  it('passes FLAC progress through and ends at 1', async () => {
    const seen: number[] = [];
    await encodeTake(
      { samples: tone(1, 48000), sampleRate: 48000, trimSamples: 0 },
      { encodeFlac: okFlac, onProgress: (f) => seen.push(f) },
    );
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('refuses an empty take', async () => {
    await expect(
      encodeTake(
        { samples: new Float32Array(0), sampleRate: 48000, trimSamples: 0 },
        { encodeFlac: okFlac },
      ),
    ).rejects.toThrow(/nothing was recorded/i);
    await expect(
      encodeTake(
        { samples: tone(0.1, 48000), sampleRate: 48000, trimSamples: 99999 },
        { encodeFlac: okFlac },
      ),
    ).rejects.toThrow(/nothing was recorded/i);
  });
});
