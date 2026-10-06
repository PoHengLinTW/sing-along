import { readFileSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { wavBuffer } from './audio';

/** Direct API calls, for setting a scene up quickly (the UI is what the tests then exercise). */
export async function apiCreateProject(request: APIRequestContext, title: string) {
  const res = await request.post('/api/projects', { data: { title } });
  if (!res.ok()) throw new Error(`create project failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: number; title: string };
}

/** upload-url -> PUT to storage -> confirm, exactly like the browser does. */
export async function apiLabelId(request: APIRequestContext, name: string) {
  const all = (await (await request.get('/api/labels')).json()) as { id: number; name: string }[];
  const found = all.find((l) => l.name === name);
  if (!found) throw new Error(`no label ${name}`);
  return found.id;
}

export async function apiUploadTrack(
  request: APIRequestContext,
  projectId: number,
  name: string,
  seconds = 1,
  labelNames: string[] = [],
) {
  const labels = await Promise.all(labelNames.map((n) => apiLabelId(request, n)));
  const body = wavBuffer(seconds);
  const target = await request.post(`/api/projects/${projectId}/tracks/upload-url`, {
    data: {
      name,
      labels,
      mimeType: 'audio/wav',
      sizeBytes: body.length,
      durationMs: Math.round(seconds * 1000),
      source: 'upload',
      peaks: Array.from({ length: seconds * 100 }, (_, i) => (i % 10) / 10),
    },
  });
  if (!target.ok()) throw new Error(`upload-url failed: ${target.status()} ${await target.text()}`);
  const { trackId, uploadUrl, headers } = (await target.json()) as {
    trackId: number;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  const put = await fetch(uploadUrl, { method: 'PUT', headers, body: new Uint8Array(body) });
  if (!put.ok) throw new Error(`storage PUT failed: ${put.status}`);
  const confirmed = await request.post(`/api/tracks/${trackId}/confirm`);
  if (!confirmed.ok()) throw new Error(`confirm failed: ${confirmed.status()}`);
  return trackId;
}

const TONE_MP3 = new URL('./fixtures/tone-5s.mp3', import.meta.url);

/** A saved 5 s MP3 track (a real file, so editing it has to decode MP3 and encode FLAC). */
export async function apiUploadMp3(request: APIRequestContext, projectId: number, name: string) {
  const body = readFileSync(TONE_MP3);
  const target = await request.post(`/api/projects/${projectId}/tracks/upload-url`, {
    data: {
      name,
      labels: [],
      mimeType: 'audio/mpeg',
      sizeBytes: body.length,
      durationMs: 5000,
      source: 'upload',
      peaks: Array.from({ length: 500 }, (_, i) => (i % 10) / 10),
    },
  });
  if (!target.ok()) throw new Error(`upload-url failed: ${target.status()} ${await target.text()}`);
  const { trackId, uploadUrl, headers } = (await target.json()) as {
    trackId: number;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  const put = await fetch(uploadUrl, { method: 'PUT', headers, body: new Uint8Array(body) });
  if (!put.ok) throw new Error(`storage PUT failed: ${put.status}`);
  const confirmed = await request.post(`/api/tracks/${trackId}/confirm`);
  if (!confirmed.ok()) throw new Error(`confirm failed: ${confirmed.status()}`);
  return trackId;
}

export async function apiDeleteProject(request: APIRequestContext, id: number) {
  await request.delete(`/api/projects/${id}`);
}
