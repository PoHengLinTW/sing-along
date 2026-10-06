import { describe, expect, it, vi } from 'vitest';
import { type ReplaceParams, replaceTrackAudio } from './upload';

const blob = (size = 5000) => new Blob([new Uint8Array(size)], { type: 'audio/flac' });

function setup(over: { put?: ReturnType<typeof vi.fn>; failAt?: string } = {}) {
  const calls: { path: string; body?: unknown; method?: string }[] = [];
  const apiFetch = vi.fn(async (path: string, opts?: { body?: unknown; method?: string }) => {
    calls.push({ path, body: opts?.body, method: opts?.method });
    if (over.failAt && path.endsWith(over.failAt)) throw new Error(`${over.failAt} failed`);
    if (path.endsWith('/replace-url')) {
      return {
        key: 'projects/5/tracks/9-abc.flac',
        uploadUrl: 'https://s3/put',
        headers: { 'Content-Type': 'audio/flac' },
        expiresAt: '',
      };
    }
    return { id: 9, name: 'Alto', durationMs: 4000 };
  });
  const put =
    over.put ??
    vi.fn(async (_u: string, _b: Blob, _h: unknown, onProgress: (f: number) => void) =>
      onProgress(1),
    );
  return { deps: { apiFetch, put } as never, calls, put };
}

const params = (over: Partial<ReplaceParams> = {}): ReplaceParams => ({
  trackId: 9,
  blob: blob(),
  mimeType: 'audio/flac',
  durationMs: 4000,
  peaks: [0.1, 0.9],
  startOffsetMs: 1000,
  latencyOffsetMs: 2500,
  form: { name: 'Alto', performer: 'Ann', labelIds: [3] },
  ...over,
});

describe('replaceTrackAudio', () => {
  it('asks for a place to upload, uploads there, then swaps the track over to the new file', async () => {
    const { deps, calls, put } = setup();
    const track = await replaceTrackAudio(deps, params());
    expect(calls.map((c) => c.path)).toEqual([
      '/api/tracks/9/replace-url',
      '/api/tracks/9/replace',
    ]);
    expect(calls.every((c) => c.method === 'POST')).toBe(true);
    expect(put).toHaveBeenCalledWith(
      'https://s3/put',
      expect.anything(),
      { 'Content-Type': 'audio/flac' },
      expect.any(Function),
      undefined,
    );
    expect(track).toMatchObject({ id: 9, name: 'Alto' });
  });

  it('announces the size, length and format before uploading', async () => {
    const { deps, calls } = setup();
    await replaceTrackAudio(deps, params({ blob: blob(1234) }));
    expect(calls[0]?.body).toEqual({ mimeType: 'audio/flac', sizeBytes: 1234, durationMs: 4000 });
  });

  it('confirms with the key it was given, the peaks, the placement and the text fields', async () => {
    const { deps, calls } = setup();
    await replaceTrackAudio(deps, params({ blob: blob(1234) }));
    expect(calls[1]?.body).toEqual({
      key: 'projects/5/tracks/9-abc.flac',
      mimeType: 'audio/flac',
      sizeBytes: 1234,
      durationMs: 4000,
      peaks: [0.1, 0.9],
      startOffsetMs: 1000,
      latencyOffsetMs: 2500,
      name: 'Alto',
      performer: 'Ann',
      labels: [3],
    });
  });

  it('reports upload progress and passes cancellation through', async () => {
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    const { deps, put } = setup();
    await replaceTrackAudio(deps, params({ onProgress, signal }));
    const [, , , progress, sig] = put.mock.calls[0] as unknown[];
    (progress as (f: number) => void)(0.4);
    expect(onProgress).toHaveBeenCalledWith(0.4);
    expect(sig).toBe(signal);
  });

  it('never confirms if the upload fails, so the track keeps its old audio', async () => {
    const put = vi.fn(async () => Promise.reject(new Error('Upload failed (500)')));
    const { deps, calls } = setup({ put });
    await expect(replaceTrackAudio(deps, params())).rejects.toThrow('Upload failed (500)');
    expect(calls.map((c) => c.path)).toEqual(['/api/tracks/9/replace-url']);
  });

  it('does not upload if the server refuses the replacement (a cap, a deleted track)', async () => {
    const { deps, put } = setup({ failAt: '/replace-url' });
    await expect(replaceTrackAudio(deps, params())).rejects.toThrow('/replace-url failed');
    expect(put).not.toHaveBeenCalled();
  });
});
