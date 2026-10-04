/** One stretch of mono audio placed on the song timeline. */
export interface Piece {
  samples: Float32Array;
  sampleRate: number;
  /** Song time (ms) of the first sample. May be negative. */
  startMs: number;
}

const toSample = (ms: number, sampleRate: number) => Math.round((ms * sampleRate) / 1000);

/** Sample index of the song time `tMs` inside the piece. */
const indexAt = (p: Piece, tMs: number) => toSample(tMs - p.startMs, p.sampleRate);

/**
 * Splits at a song time into two adjacent pieces that play exactly as the original did: no sample
 * is lost or repeated. Null when the cut would leave one side empty.
 */
export function cutPiece(p: Piece, tMs: number): [Piece, Piece] | null {
  const i = indexAt(p, tMs);
  if (i <= 0 || i >= p.samples.length) return null;
  return [
    { ...p, samples: p.samples.slice(0, i) },
    { ...p, samples: p.samples.slice(i), startMs: tMs },
  ];
}

/** Drops the audio before `tMs`. What remains keeps its song position, so the end does not move. */
export function trimBefore(p: Piece, tMs: number): Piece | null {
  const i = indexAt(p, tMs);
  if (i <= 0 || i >= p.samples.length) return null;
  return { ...p, samples: p.samples.slice(i), startMs: tMs };
}

/** Drops the audio after `tMs`; the start stays. */
export function trimAfter(p: Piece, tMs: number): Piece | null {
  const i = indexAt(p, tMs);
  if (i <= 0 || i >= p.samples.length) return null;
  return { ...p, samples: p.samples.slice(0, i) };
}

export type CombineResult =
  | { piece: Piece }
  | { error: 'too-few' }
  | { error: 'sample-rate' }
  | { error: 'overlap'; overlapMs: number };

/**
 * Joins pieces into one, in song order. Gaps become silence so no phrase moves. Overlaps are
 * refused: layering two takes by accident sounds like a timing bug, so the user resolves them.
 */
export function combinePieces(pieces: Piece[]): CombineResult {
  if (pieces.length < 2) return { error: 'too-few' };
  const sampleRate = (pieces[0] as Piece).sampleRate;
  if (pieces.some((p) => p.sampleRate !== sampleRate)) return { error: 'sample-rate' };
  const sorted = [...pieces].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0] as Piece;
  const offsets = sorted.map((p) => toSample(p.startMs - first.startMs, sampleRate));
  let end = 0;
  for (const [k, p] of sorted.entries()) {
    const at = offsets[k] as number;
    if (at < end) {
      return { error: 'overlap', overlapMs: Math.round(((end - at) * 1000) / sampleRate) };
    }
    end = at + p.samples.length;
  }
  const samples = new Float32Array(end);
  for (const [k, p] of sorted.entries()) samples.set(p.samples, offsets[k] as number);
  return { piece: { samples, sampleRate, startMs: first.startMs } };
}
