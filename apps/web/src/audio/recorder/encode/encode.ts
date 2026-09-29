import { computePeaks } from '../../../lib/peaks';
import { encodeWav16Mono } from './pcm';

const PEAKS_PER_SEC = 100; // same density as uploaded tracks

export interface EncodeInput {
  samples: Float32Array;
  sampleRate: number;
  /** Leading samples that fall before timeline 0. */
  trimSamples: number;
}

export interface EncodedTake {
  bytes: Uint8Array;
  mimeType: 'audio/flac' | 'audio/wav';
  peaks: number[];
  durationMs: number;
  /** FLAC was unavailable, so this is a (larger) WAV. */
  fellBack: boolean;
}

export interface EncodeDeps {
  encodeFlac: (
    samples: Float32Array,
    sampleRate: number,
    onProgress?: (fraction: number) => void,
  ) => Promise<Uint8Array>;
  onProgress?: (fraction: number) => void;
}

/**
 * Trim, measure and encode one take: FLAC 16-bit mono, or WAV if the FLAC encoder fails (for
 * instance its module cannot load). Pure of browser APIs so it runs in a worker and in tests.
 */
export async function encodeTake(input: EncodeInput, deps: EncodeDeps): Promise<EncodedTake> {
  const samples = input.samples.subarray(Math.min(input.trimSamples, input.samples.length));
  if (samples.length === 0) throw new Error('Nothing was recorded.');
  const { sampleRate } = input;
  const peaks = computePeaks([samples], sampleRate, PEAKS_PER_SEC);
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  try {
    const bytes = await deps.encodeFlac(samples, sampleRate, deps.onProgress);
    return { bytes, mimeType: 'audio/flac', peaks, durationMs, fellBack: false };
  } catch {
    const bytes = encodeWav16Mono(samples, sampleRate);
    deps.onProgress?.(1);
    return { bytes, mimeType: 'audio/wav', peaks, durationMs, fellBack: true };
  }
}
