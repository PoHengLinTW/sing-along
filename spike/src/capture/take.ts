export function concatChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function takeDurationMs(sampleCount: number, sampleRate: number): number {
  return (sampleCount / sampleRate) * 1000;
}

export function sampleCountMatches(sampleCount: number, expectedSec: number, sampleRate: number, toleranceMs: number): boolean {
  return Math.abs(takeDurationMs(sampleCount, sampleRate) - expectedSec * 1000) <= toleranceMs;
}

export interface Take {
  samples: Float32Array;
  sampleRate: number;
  startOffsetMs: number;
}

export function trimBeforeZero(samples: Float32Array, sampleRate: number, startSec: number): { samples: Float32Array; startSec: number } {
  if (startSec >= 0) return { samples, startSec };
  const drop = Math.min(samples.length, Math.round(-startSec * sampleRate));
  return { samples: samples.subarray(drop), startSec: 0 };
}
