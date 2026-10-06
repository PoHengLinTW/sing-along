import type { AudioUrlResponse } from '@sing-along/shared';
import { apiFetch } from '../api/client';
import { getAudioController } from './controller';

interface Deps {
  api: (path: string) => Promise<AudioUrlResponse>;
  download: (url: string) => Promise<Response>;
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>;
}

const REFUSED = new Set([400, 401, 403]);

/**
 * Downloads and decodes a track's audio straight from storage. Cached by track id and version:
 * a saved track's audio can be overwritten after an edit, which changes its version, so the old
 * buffer is dropped and never served again.
 */
export function createBufferLoader(deps: Deps) {
  const cache = new Map<number, { version: string | undefined; promise: Promise<AudioBuffer> }>();
  return (trackId: number, version?: string): Promise<AudioBuffer> => {
    const hit = cache.get(trackId);
    if (hit && hit.version === version) return hit.promise;
    const promise = (async () => {
      const fetchAudio = async () => {
        const { url } = await deps.api(`/api/tracks/${trackId}/audio-url`);
        return deps.download(url);
      };
      let res = await fetchAudio();
      // An expired or otherwise refused signature: ask for a fresh URL and try once more.
      if (REFUSED.has(res.status)) res = await fetchAudio();
      if (!res.ok) throw new Error(`Audio download failed (${res.status})`);
      return deps.decode(await res.arrayBuffer());
    })();
    cache.set(trackId, { version, promise });
    // Failures are not cached (unless a newer version already took the place).
    promise.catch(() => {
      if (cache.get(trackId)?.promise === promise) cache.delete(trackId);
    });
    return promise;
  };
}

export const loadTrackBuffer = createBufferLoader({
  api: (path) => apiFetch<AudioUrlResponse>(path),
  download: (url) => fetch(url),
  decode: (data) => getAudioController().engine.decode(data),
});
