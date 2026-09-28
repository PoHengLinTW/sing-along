import Flac from 'libflacjs/dist/libflac.js';
import { floatToInt16 } from './pcm';

const COMPRESSION = 5; // libFLAC default; higher levels cost CPU for little gain on voice

async function ready(): Promise<typeof Flac> {
  if (!Flac.isReady()) await new Promise<void>((r) => Flac.on('ready', () => r()));
  return Flac;
}

/** FLAC 16-bit mono via libFLAC (libflacjs). Runs in a Web Worker in the app. */
export async function encodeFlac(samples: Float32Array, sampleRate: number): Promise<Uint8Array> {
  const F = await ready();
  const enc = F.create_libflac_encoder(sampleRate, 1, 16, COMPRESSION, samples.length, false, 0);
  if (!enc) throw new Error('FLAC encoder creation failed');
  const parts: Uint8Array[] = [];
  const status = F.init_encoder_stream(enc, (data: Uint8Array) => void parts.push(new Uint8Array(data)), () => {});
  if (status !== 0) throw new Error(`FLAC encoder init failed: ${status}`);
  const pcm = floatToInt16(samples);
  const CHUNK = 1 << 16;
  for (let i = 0; i < pcm.length; i += CHUNK) {
    const block = Int32Array.from(pcm.subarray(i, i + CHUNK));
    if (!F.FLAC__stream_encoder_process_interleaved(enc, block, block.length)) throw new Error('FLAC encoding failed');
  }
  F.FLAC__stream_encoder_finish(enc);
  F.FLAC__stream_encoder_delete(enc);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
