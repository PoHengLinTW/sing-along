import { registerFlacEncoder } from '@mediabunny/flac-encoder';
import { AudioBufferSource, BufferTarget, FlacOutputFormat, Output } from 'mediabunny';
import { encodeInWorker } from './encode/client';

const log = (line: string) => {
  document.querySelector('#log')!.textContent += `${line}\n`;
  console.log(line);
};

function syntheticTake(sampleRate: number, seconds: number): Float32Array {
  const samples = new Float32Array(sampleRate * seconds);
  let seed = 1;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = (0.5 + 0.5 * Math.sin(i / 20000)) *
      (0.4 * Math.sin(i * 0.031) + 0.2 * Math.sin(i * 0.11)) +
      (seed / 2 ** 32 - 0.5) * 0.02;
  }
  return samples;
}

document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  const button = document.querySelector<HTMLButtonElement>('#run')!;
  button.disabled = true;
  try {
    const sampleRate = 48000;
    const seconds = 240;
    const samples = syntheticTake(sampleRate, seconds);
    const audio = new AudioBuffer({ numberOfChannels: 1, length: samples.length, sampleRate });
    audio.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

    const libflac = await encodeInWorker(samples, sampleRate);
    if (!libflac.flac) throw new Error(`libflacjs: ${libflac.flacError}`);
    log(`libflacjs asm.js: ${libflac.flacMs!.toFixed(0)} ms, ${libflac.flac.length} bytes`);

    registerFlacEncoder();
    const target = new BufferTarget();
    const output = new Output({ format: new FlacOutputFormat(), target });
    const source = new AudioBufferSource({ codec: 'flac', transform: { sampleFormat: 's16' } });
    output.addAudioTrack(source);
    const t0 = performance.now();
    await output.start();
    await source.add(audio);
    await output.finalize();
    const elapsed = performance.now() - t0;
    const bytes = new Uint8Array(target.buffer!);
    log(`Mediabunny WASM: ${elapsed.toFixed(0)} ms, ${bytes.length} bytes`);

    const ctx = new AudioContext({ sampleRate });
    for (const [name, data] of [['libflacjs', libflac.flac], ['Mediabunny', bytes]] as const) {
      const decoded = await ctx.decodeAudioData(data.slice().buffer);
      const channel = decoded.getChannelData(0);
      let maxError = 0;
      for (let i = 0; i < samples.length; i++) maxError = Math.max(maxError, Math.abs(channel[i] - samples[i]));
      log(`${name} decode: ${decoded.duration.toFixed(3)} s, ${decoded.numberOfChannels} ch, ${decoded.sampleRate} Hz, max 16-bit error ${maxError.toFixed(6)}`);
      if (decoded.length !== samples.length || decoded.numberOfChannels !== 1 || maxError > 2 / 32768) {
        throw new Error(`${name} output is not a 16-bit mono round trip`);
      }
    }
    await ctx.close();
    log('Comparison complete');
  } catch (error) {
    log(`Comparison failed: ${(error as Error).message}`);
  } finally {
    button.disabled = false;
  }
};
