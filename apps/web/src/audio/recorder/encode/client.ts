import { type EncodedTake, type EncodeInput, encodeTake } from './encode';
import type { WorkerResponse } from './encode.worker';

/** Last resort if the worker script itself cannot start: WAV on the main thread. */
const encodeOnMainThread = (input: EncodeInput, onProgress?: (f: number) => void) =>
  encodeTake(input, {
    encodeFlac: () => Promise.reject(new Error('encoder worker unavailable')),
    onProgress,
  });

/** Encodes off the main thread so the UI and playback stay responsive. */
export function encodeInWorker(
  input: EncodeInput,
  onProgress?: (fraction: number) => void,
): Promise<EncodedTake> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      encodeOnMainThread(input, onProgress).then(resolve, reject);
      return;
    }
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress?.(m.fraction);
      worker.terminate();
      if (m.type === 'done') resolve(m.result);
      else reject(new Error(m.message));
    };
    worker.onerror = () => {
      worker.terminate();
      encodeOnMainThread(input, onProgress).then(resolve, reject);
    };
    // Copy: the draft store keeps its chunks until the encoded file is saved.
    const samples = input.samples.slice();
    worker.postMessage({ ...input, samples } satisfies EncodeInput, [samples.buffer]);
  });
}
