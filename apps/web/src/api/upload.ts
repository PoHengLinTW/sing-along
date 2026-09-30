import type { Caps, TrackDto, UploadUrlRequest, UploadUrlResponse } from '@sing-along/shared';
import { resolveAudioMime } from '../lib/audioFile';
import { durationCapMessage, fileCapMessage } from '../lib/caps';
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
    file: Blob,
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
  /** Checked before anything is sent; the server enforces the same caps. */
  caps?: Caps;
}

export interface PreparedUpload {
  projectId: number;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  peaks: number[];
  startOffsetMs: number;
  latencyOffsetMs: number;
  source: 'upload' | 'recording';
  form: { name: string; performer: string; labelIds: number[] };
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * upload-url -> PUT to storage -> confirm, for audio whose metadata is already known (a recorded
 * take has its peaks and duration from the encoder). Audio goes browser -> storage directly.
 * Cancelling aborts the PUT; the pending track is left for the M3 cleanup.
 */
export async function uploadPrepared(
  deps: Pick<UploadDeps, 'apiFetch' | 'put'>,
  p: PreparedUpload,
): Promise<TrackDto> {
  const body: UploadUrlRequest = {
    name: p.form.name,
    performer: p.form.performer,
    labels: p.form.labelIds,
    mimeType: p.mimeType,
    sizeBytes: p.blob.size,
    durationMs: p.durationMs,
    startOffsetMs: p.startOffsetMs,
    latencyOffsetMs: p.latencyOffsetMs,
    source: p.source,
    peaks: p.peaks,
  };
  const target = await deps.apiFetch<UploadUrlResponse>(
    `/api/projects/${p.projectId}/tracks/upload-url`,
    { method: 'POST', body, signal: p.signal },
  );
  await deps.put(target.uploadUrl, p.blob, target.headers, p.onProgress ?? (() => {}), p.signal);
  return deps.apiFetch<TrackDto>(`/api/tracks/${target.trackId}/confirm`, {
    method: 'POST',
    signal: p.signal,
  });
}

/** Upload a file from disk: decode it for its peaks and duration, then `uploadPrepared`. */
export async function uploadTrack(deps: UploadDeps, p: UploadParams): Promise<TrackDto> {
  const mimeType = resolveAudioMime(p.file);
  if (!mimeType) throw new Error('Unsupported format.');

  const tooBig = p.caps && fileCapMessage(p.file, p.caps);
  if (tooBig) throw new Error(tooBig);

  let audio: DecodedAudio;
  try {
    audio = await deps.decode(await p.file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as audio.');
  }

  const durationMs = Math.round(audio.durationSec * 1000);
  const tooLong = p.caps && durationCapMessage(durationMs, p.caps);
  if (tooLong) throw new Error(tooLong);

  return uploadPrepared(deps, {
    projectId: p.projectId,
    blob: p.file,
    mimeType,
    durationMs,
    peaks: computePeaks(audio.channels, audio.sampleRate, PEAKS_PER_SEC),
    startOffsetMs: 0,
    latencyOffsetMs: 0,
    source: 'upload',
    form: p.form,
    onProgress: p.onProgress,
    signal: p.signal,
  });
}
