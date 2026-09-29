import { describe, expect, it } from 'vitest';
import { ChunkBatcher } from './chunker';

const quantum = (v: number) => new Float32Array(128).fill(v);

function feed(b: ChunkBatcher, seconds: number, rate: number, v = 0.5) {
  const out: Float32Array[] = [];
  const n = Math.round((seconds * rate) / 128);
  for (let i = 0; i < n; i++) out.push(...b.push(quantum(v)));
  return out;
}

describe('ChunkBatcher', () => {
  it('emits chunks of about one second', () => {
    const b = new ChunkBatcher(48000);
    const chunks = feed(b, 3.5, 48000);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(Math.abs(c.length - 48000)).toBeLessThan(128);
  });

  it('flush returns the remainder and nothing is lost', () => {
    const b = new ChunkBatcher(44100);
    const chunks = feed(b, 2.3, 44100);
    const rest = b.flush();
    const total = [...chunks, ...(rest ? [rest] : [])].reduce((n, c) => n + c.length, 0);
    expect(total).toBe(Math.round((2.3 * 44100) / 128) * 128);
    expect(b.flush()).toBeNull();
  });

  it('a 60 s take is within 50 ms of 60 s', () => {
    const b = new ChunkBatcher(48000);
    let total = feed(b, 60, 48000).reduce((n, c) => n + c.length, 0);
    total += b.flush()?.length ?? 0;
    expect(Math.abs((total / 48000) * 1000 - 60000)).toBeLessThanOrEqual(50);
  });

  it('muted samples become digital silence and the length is kept', () => {
    const b = new ChunkBatcher(1280);
    const out: Float32Array[] = [];
    out.push(...b.push(quantum(0.5)));
    b.setMuted(true);
    for (let i = 0; i < 4; i++) out.push(...b.push(quantum(0.5)));
    b.setMuted(false);
    for (let i = 0; i < 5; i++) out.push(...b.push(quantum(0.5)));
    const all = new Float32Array(out.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of out) {
      all.set(c, at);
      at += c.length;
    }
    expect(all.length).toBe(10 * 128);
    expect(all.subarray(0, 128).every((s) => s === 0.5)).toBe(true);
    expect(all.subarray(128, 5 * 128).every((s) => s === 0)).toBe(true);
    expect(all.subarray(5 * 128).every((s) => s === 0.5)).toBe(true);
  });

  it('does not modify the caller buffer when muting', () => {
    const b = new ChunkBatcher(48000);
    b.setMuted(true);
    const q = quantum(0.5);
    b.push(q);
    expect(q[0]).toBe(0.5);
  });
});
