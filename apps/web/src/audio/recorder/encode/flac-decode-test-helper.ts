import Flac from 'libflacjs/dist/libflac.js';

/** Test-only: decode a FLAC file with libFLAC so tests can prove encoding is lossless. */
export async function decodeFlacToInt16(
  data: Uint8Array,
): Promise<{ samples: Int16Array; sampleRate: number; channels: number }> {
  if (!Flac.isReady()) await new Promise<void>((r) => Flac.on('ready', () => r()));
  const dec = Flac.create_libflac_decoder(false);
  let pos = 0;
  const out: number[] = [];
  let sampleRate = 0;
  let channels = 0;
  Flac.init_decoder_stream(
    dec,
    ((n: number) => {
      if (pos >= data.length) return { buffer: undefined, readDataLength: 0, error: false };
      const chunk = data.subarray(pos, pos + n);
      pos += chunk.length;
      return { buffer: chunk, readDataLength: chunk.length, error: false };
    }) as never,
    (chunks: Uint8Array[], frame: { blocksize: number }) => {
      const first = chunks[0];
      if (!first) return;
      const view = new Int16Array(first.buffer, first.byteOffset, first.byteLength / 2);
      for (let i = 0; i < frame.blocksize; i++) out.push(view[i] ?? 0);
    },
    (code: number) => {
      throw new Error(`decode error ${code}`);
    },
    (meta: { sampleRate: number; channels: number } | undefined) => {
      if (meta) {
        sampleRate = meta.sampleRate;
        channels = meta.channels;
      }
    },
  );
  Flac.FLAC__stream_decoder_process_until_end_of_stream(dec);
  Flac.FLAC__stream_decoder_finish(dec);
  Flac.FLAC__stream_decoder_delete(dec);
  return { samples: Int16Array.from(out), sampleRate, channels };
}
