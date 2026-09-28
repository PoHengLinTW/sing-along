// Node benchmark of FLAC encoder candidates on a synthetic 4-minute voice-like take.
// Usage: node bench/encoders.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sr = 48000, secs = 240;
const x = new Float32Array(sr * secs);
let seed = 1;
for (let i = 0; i < x.length; i++) {
  seed = (seed * 1664525 + 1013904223) >>> 0; // cheap noise: voice is not a pure tone
  const env = 0.5 + 0.5 * Math.sin(i / 20000);
  x[i] = env * (0.4 * Math.sin(i * 0.031) + 0.2 * Math.sin(i * 0.11)) + ((seed / 2 ** 32) - 0.5) * 0.02;
}
const pcm = Int32Array.from(x, (v) => Math.max(-32768, Math.min(32767, Math.floor(v * 32767 + 0.5))));

async function run(label, path) {
  const F = require(path);
  const Flac = F.default || F;
  if (!Flac.isReady()) await new Promise((r) => Flac.on('ready', r));
  const t0 = performance.now();
  const parts = [];
  const enc = Flac.create_libflac_encoder(sr, 1, 16, 5, pcm.length, false, 0);
  Flac.init_encoder_stream(enc, (d) => parts.push(d.length), () => {});
  for (let i = 0; i < pcm.length; i += 65536) {
    const b = pcm.subarray(i, i + 65536);
    Flac.FLAC__stream_encoder_process_interleaved(enc, b, b.length);
  }
  Flac.FLAC__stream_encoder_finish(enc);
  Flac.FLAC__stream_encoder_delete(enc);
  const ms = performance.now() - t0;
  const bytes = parts.reduce((a, b) => a + b, 0);
  console.log(`${label}: ${ms.toFixed(0)} ms for ${secs}s, ${(bytes / 1e6).toFixed(2)} MB (${(bytes / 1e6 / (secs / 60)).toFixed(2)} MB/min)`);
}
await run('libflacjs asm.js build ', 'libflacjs/dist/libflac.js');
await run('libflacjs wasm build   ', 'libflacjs/dist/libflac.min.wasm.js');
