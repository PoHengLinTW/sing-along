import { type EncodedTake, type EncodeInput, encodeTake } from './encode';
import { encodeFlac } from './flac';

export type WorkerRequest = EncodeInput;
export type WorkerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result: EncodedTake }
  | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    const result = await encodeTake(e.data, {
      encodeFlac,
      onProgress: (fraction) => post({ type: 'progress', fraction }),
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
