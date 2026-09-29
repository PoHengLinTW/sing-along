import { describe, expect, it, vi } from 'vitest';
import { type PreparedUpload, uploadPrepared } from './upload';

const blob = (size = 5000) => new Blob([new Uint8Array(size)], { type: 'audio/flac' });

function setup(over: { put?: ReturnType<typeof vi.fn> } = {}) {
  const bodies: unknown[] = [];
  const calls: string[] = [];
  const apiFetch = vi.fn(async (path: string, opts?: { body?: unknown }) => {
    calls.push(path);
    if (path.endsWith('/upload-url')) {
      bodies.push(opts?.body);
      return {
        trackId: 9,
        uploadUrl: 'https://s3/put',
        headers: { 'Content-Type': 'audio/flac' },
        expiresAt: '',
      };
    }
    return { id: 9, name: 'Take 1' };
  });
  const put =
    over.put ??
    vi.fn(async (_u: string, _b: Blob, _h: unknown, onProgress: (f: number) => void) =>
      onProgress(1),
    );
  return { deps: { apiFetch, put } as never, bodies, calls, put };
}

const params = (over: Partial<PreparedUpload> = {}): PreparedUpload => ({
  projectId: 5,
  blob: blob(),
  mimeType: 'audio/flac',
  durationMs: 4000,
  peaks: [0.1, 0.9],
  startOffsetMs: 1500,
  latencyOffsetMs: -85,
  source: 'recording',
  form: { name: 'Take 1', performer: 'Ann', labelIds: [3] },
  ...over,
});

describe('uploadPrepared', () => {
  it('sends the take exactly as recorded: offsets, source, peaks, duration, size and labels', async () => {
    const { deps, bodies } = setup();
    await uploadPrepared(deps, params());
    expect(bodies[0]).toEqual({
      name: 'Take 1',
      performer: 'Ann',
      labels: [3],
      mimeType: 'audio/flac',
      sizeBytes: 5000,
      durationMs: 4000,
      startOffsetMs: 1500,
      latencyOffsetMs: -85,
      source: 'recording',
      peaks: [0.1, 0.9],
    });
  });

  it('uploads the blob to the presigned URL and then confirms, with progress', async () => {
    const { deps, calls, put } = setup();
    const progress: number[] = [];
    const track = await uploadPrepared(deps, params({ onProgress: (f) => progress.push(f) }));
    expect(calls).toEqual(['/api/projects/5/tracks/upload-url', '/api/tracks/9/confirm']);
    expect(put).toHaveBeenCalledWith(
      'https://s3/put',
      expect.any(Blob),
      { 'Content-Type': 'audio/flac' },
      expect.any(Function),
      undefined,
    );
    expect(progress).toEqual([1]);
    expect(track).toEqual({ id: 9, name: 'Take 1' });
  });

  it('does not confirm when the PUT fails', async () => {
    const { deps, calls } = setup({
      put: vi.fn(async () => Promise.reject(new Error('PUT failed (500)'))),
    });
    await expect(uploadPrepared(deps, params())).rejects.toThrow('PUT failed (500)');
    expect(calls.some((c) => c.includes('/confirm'))).toBe(false);
  });
});
