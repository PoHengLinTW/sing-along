import { encodeFlac } from './flac';
import { encodeWav16Mono } from './pcm';

export interface EncodeRequest {
  samples: Float32Array;
  sampleRate: number;
}
export interface EncodeResponse {
  flac?: Uint8Array;
  flacMs?: number;
  flacError?: string;
  wav: Uint8Array;
  wavMs: number;
}

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { samples, sampleRate } = e.data;
  const res: EncodeResponse = { wav: new Uint8Array(0), wavMs: 0 };
  try {
    const t0 = performance.now();
    res.flac = await encodeFlac(samples, sampleRate);
    res.flacMs = performance.now() - t0;
  } catch (err) {
    res.flacError = (err as Error).message; // WAV is the fallback if FLAC fails
  }
  const t1 = performance.now();
  res.wav = encodeWav16Mono(samples, sampleRate);
  res.wavMs = performance.now() - t1;
  (self as unknown as Worker).postMessage(res);
};
