/** A mono 16-bit PCM WAV of a sine tone: small, decodable by every browser, no files on disk. */
export function wavBuffer(
  seconds: number,
  opts: { sampleRate?: number; freq?: number } = {},
): Buffer {
  const sampleRate = opts.sampleRate ?? 8000;
  const freq = opts.freq ?? 220;
  const samples = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A file payload for `setInputFiles`. */
export const wavFile = (
  name: string,
  seconds = 3,
  opts?: { sampleRate?: number; freq?: number },
) => ({
  name,
  mimeType: 'audio/wav',
  buffer: wavBuffer(seconds, opts),
});
