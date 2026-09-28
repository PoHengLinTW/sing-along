export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.floor(samples[i] * 32767 + 0.5); // round half up, same as the FLAC path
    out[i] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
  }
  return out;
}

/** 16-bit PCM mono WAV: the universally decodable fallback when FLAC is unavailable. */
export function encodeWav16Mono(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcm = floatToInt16(samples);
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const dv = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  tag(36, 'data');
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  return out;
}
