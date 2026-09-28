import type { EncodeRequest, EncodeResponse } from './encode.worker';

/** Encode off the main thread so the UI and playback stay responsive. */
export function encodeInWorker(samples: Float32Array, sampleRate: number): Promise<EncodeResponse> {
  const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<EncodeResponse>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(new Error(e.message));
      worker.terminate();
    };
    const copy = samples.slice(); // keep the take intact for playback; transfer the copy
    worker.postMessage({ samples: copy, sampleRate } satisfies EncodeRequest, [copy.buffer]);
  });
}
