import { describe, expect, it } from 'vitest';
import { encodeWav16Mono, floatToInt16 } from './pcm';

describe('floatToInt16', () => {
  it('scales, rounds and clips', () => {
    const out = floatToInt16(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]));
    expect(Array.from(out)).toEqual([0, 16384, -16383, 32767, -32767, 32767, -32768]);
  });
});

describe('encodeWav16Mono', () => {
  const wav = encodeWav16Mono(new Float32Array([0, 1, -1]), 44100);
  const dv = new DataView(wav.buffer);
  const tag = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));
  it('writes a canonical 44-byte header', () => {
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(tag(36)).toBe('data');
    expect(wav.length).toBe(44 + 3 * 2);
    expect(dv.getUint32(4, true)).toBe(wav.length - 8);
  });
  it('declares PCM, mono, the sample rate and 16 bits', () => {
    expect(dv.getUint16(20, true)).toBe(1);
    expect(dv.getUint16(22, true)).toBe(1);
    expect(dv.getUint32(24, true)).toBe(44100);
    expect(dv.getUint32(28, true)).toBe(88200);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(6);
  });
  it('stores little-endian samples', () => {
    expect(dv.getInt16(44, true)).toBe(0);
    expect(dv.getInt16(46, true)).toBe(32767);
    expect(dv.getInt16(48, true)).toBe(-32767); // symmetric x32767 scaling; -32768 is only reached by clipping
  });
});
