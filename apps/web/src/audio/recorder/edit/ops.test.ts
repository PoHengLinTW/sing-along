import { describe, expect, it } from 'vitest';
import { combinePieces, cutPiece, type Piece, trimAfter, trimBefore } from './ops';

const SR = 1000; // 1 sample per ms keeps the arithmetic readable
const ramp = (n: number, from = 0) => Float32Array.from({ length: n }, (_, i) => (from + i) / 1000);
const piece = (n: number, startMs: number, from = 0): Piece => ({
  samples: ramp(n, from),
  sampleRate: SR,
  startMs,
});
const endMs = (p: Piece) => p.startMs + (p.samples.length / p.sampleRate) * 1000;

describe('cutPiece', () => {
  it('splits at a song time into two adjacent pieces with the same playback', () => {
    const [a, b] = cutPiece(piece(1000, 5000), 5400) as [Piece, Piece];
    expect(a.startMs).toBe(5000);
    expect(a.samples).toHaveLength(400);
    expect(b.startMs).toBe(5400);
    expect(b.samples).toHaveLength(600);
    // no sample lost or repeated at the join
    expect(a.samples.at(-1)).toBeCloseTo(0.399);
    expect(b.samples[0]).toBeCloseTo(0.4);
    expect(endMs(a)).toBe(b.startMs);
  });

  it('rounds the cut to the nearest sample and still places the second piece exactly', () => {
    const [a, b] = cutPiece({ samples: ramp(4800), sampleRate: 48_000, startMs: 0 }, 33) as [
      Piece,
      Piece,
    ];
    expect(a.samples).toHaveLength(1584); // 33 ms * 48 samples
    expect(b.startMs).toBe(33);
    expect(a.samples.length + b.samples.length).toBe(4800);
  });

  it.each([5000, 4000, 6000, 6001])(
    'refuses a cut at %i ms that would leave an empty piece',
    (t) => {
      expect(cutPiece(piece(1000, 5000), t)).toBeNull();
    },
  );
});

describe('trimBefore', () => {
  it('drops the audio before the cut and keeps what remains at its song position', () => {
    const p = trimBefore(piece(1000, 5000), 5250) as Piece;
    expect(p.startMs).toBe(5250);
    expect(p.samples).toHaveLength(750);
    expect(p.samples[0]).toBeCloseTo(0.25);
    expect(endMs(p)).toBe(6000); // the end did not move
  });
  it('refuses a cut outside the piece or at its very start', () => {
    expect(trimBefore(piece(1000, 5000), 5000)).toBeNull();
    expect(trimBefore(piece(1000, 5000), 4000)).toBeNull();
    expect(trimBefore(piece(1000, 5000), 6000)).toBeNull();
  });
});

describe('trimAfter', () => {
  it('drops the audio after the cut; the start stays', () => {
    const p = trimAfter(piece(1000, 5000), 5250) as Piece;
    expect(p.startMs).toBe(5000);
    expect(p.samples).toHaveLength(250);
    expect(p.samples.at(-1)).toBeCloseTo(0.249);
  });
  it('refuses a cut outside the piece or at its very end', () => {
    expect(trimAfter(piece(1000, 5000), 6000)).toBeNull();
    expect(trimAfter(piece(1000, 5000), 5000)).toBeNull();
    expect(trimAfter(piece(1000, 5000), 7000)).toBeNull();
  });
});

describe('combinePieces', () => {
  it('joins adjacent pieces into one with no gap', () => {
    const a = piece(400, 5000);
    const b = piece(600, 5400, 400);
    const r = combinePieces([b, a]); // order given does not matter
    if ('error' in r) throw new Error('unexpected');
    expect(r.piece.startMs).toBe(5000);
    expect(r.piece.samples).toHaveLength(1000);
    expect(Array.from(r.piece.samples)).toEqual(Array.from(ramp(1000)));
  });

  it('fills the gap between pieces with silence so nothing shifts', () => {
    const r = combinePieces([piece(100, 1000, 1000), piece(100, 1300, 2000)]);
    if ('error' in r) throw new Error('unexpected');
    expect(r.piece.startMs).toBe(1000);
    expect(r.piece.samples).toHaveLength(400); // 100 + 200 silent + 100
    expect(r.piece.samples[99]).toBeCloseTo(1.099);
    expect(r.piece.samples[100]).toBe(0);
    expect(r.piece.samples[299]).toBe(0);
    expect(r.piece.samples[300]).toBeCloseTo(2);
  });

  it('refuses overlapping pieces and says by how much', () => {
    const r = combinePieces([piece(1000, 0), piece(500, 800)]);
    expect(r).toEqual({ error: 'overlap', overlapMs: 200 });
  });

  it('refuses pieces recorded at different sample rates', () => {
    const r = combinePieces([piece(100, 0), { ...piece(100, 100), sampleRate: 2000 }]);
    expect(r).toEqual({ error: 'sample-rate' });
  });

  it('needs at least two pieces', () => {
    expect(combinePieces([piece(100, 0)])).toEqual({ error: 'too-few' });
  });

  it('works with a start before zero', () => {
    const r = combinePieces([piece(100, -150), piece(100, -50)]);
    if ('error' in r) throw new Error('unexpected');
    expect(r.piece.startMs).toBe(-150);
    expect(r.piece.samples).toHaveLength(200);
  });
});
