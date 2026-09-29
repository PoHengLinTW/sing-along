import type { AudioUrlResponse } from '@sing-along/shared';
import { apiFetch } from '../api/client';
import { getAudioController } from './controller';

interface Deps {
  api: (path: string) => Promise<AudioUrlResponse>;
  download: (url: string) => Promise<Response>;
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>;
}

/** Downloads and decodes a track's audio straight from storage. Cached by track id (audio never changes after upload). */
export function createBufferLoader(deps: Deps) {
  const cache = new Map<number, Promise<AudioBuffer>>();
  return (trackId: number): Promise<AudioBuffer> => {
    const hit = cache.get(trackId);
    if (hit) return hit;
    const promise = (async () => {
      const { url } = await deps.api(`/api/tracks/${trackId}/audio-url`);
      const res = await deps.download(url);
      if (!res.ok) throw new Error(`Audio download failed (${res.status})`);
      return deps.decode(await res.arrayBuffer());
    })();
    cache.set(trackId, promise);
    promise.catch(() => cache.delete(trackId)); // failures are not cached
    return promise;
  };
}

export const loadTrackBuffer = createBufferLoader({
  api: (path) => apiFetch<AudioUrlResponse>(path),
  download: (url) => fetch(url),
  decode: (data) => getAudioController().engine.decode(data),
});
