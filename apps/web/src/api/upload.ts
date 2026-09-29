import type { TrackDto, UploadUrlRequest, UploadUrlResponse } from '@sing-along/shared';
import { resolveAudioMime } from '../lib/audioFile';
import { computePeaks } from '../lib/peaks';
import type { apiFetch as ApiFetch } from './client';

const PEAKS_PER_SEC = 100;

export interface DecodedAudio {
  durationSec: number;
  sampleRate: number;
  channels: Float32Array[];
}

export interface UploadDeps {
  decode: (data: ArrayBuffer) => Promise<DecodedAudio>;
  apiFetch: typeof ApiFetch;
  /** PUT the file straight to storage; reports progress as a 0..1 fraction. */
  put: (
    url: string,
    file: File,
    headers: Record<string, string>,
    onProgress: (fraction: number) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
}

export interface UploadParams {
  projectId: number;
  file: File;
  form: { name: string; performer: string; labelIds: number[] };
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * upload-url -> PUT to storage -> confirm. Audio goes browser -> storage directly.
 * Cancelling aborts the PUT; the pending track is left for the M3 cleanup.
 */
export async function uploadTrack(deps: UploadDeps, p: UploadParams): Promise<TrackDto> {
  const mimeType = resolveAudioMime(p.file);
  if (!mimeType) throw new Error('Unsupported format.');

  let audio: DecodedAudio;
  try {
    audio = await deps.decode(await p.file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as audio.');
  }

  const body: UploadUrlRequest = {
    name: p.form.name,
    performer: p.form.performer,
    labels: p.form.labelIds,
    mimeType,
    sizeBytes: p.file.size,
    durationMs: Math.round(audio.durationSec * 1000),
    startOffsetMs: 0,
    source: 'upload',
    peaks: computePeaks(audio.channels, audio.sampleRate, PEAKS_PER_SEC),
  };
  const target = await deps.apiFetch<UploadUrlResponse>(
    `/api/projects/${p.projectId}/tracks/upload-url`,
    {
      method: 'POST',
      body,
      signal: p.signal,
    },
  );
  await deps.put(target.uploadUrl, p.file, target.headers, p.onProgress ?? (() => {}), p.signal);
  return deps.apiFetch<TrackDto>(`/api/tracks/${target.trackId}/confirm`, {
    method: 'POST',
    signal: p.signal,
  });
}
