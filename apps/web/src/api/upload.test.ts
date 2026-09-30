import { DEFAULT_CAPS } from '@sing-along/shared';
import { describe, expect, it, vi } from 'vitest';
import { type UploadDeps, uploadTrack } from './upload';

const file = (name = 'take.flac', type = 'audio/flac', size = 5000) =>
  ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as File;

function deps(over: Partial<UploadDeps> = {}) {
  const calls: string[] = [];
  const d: UploadDeps = {
    decode: async () => {
      calls.push('decode');
      return {
        durationSec: 4,
        sampleRate: 4,
        channels: [new Float32Array([0.5, 1, 0, 0.25, 0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      };
    },
    apiFetch: (async (path: string, opts?: { body?: unknown }) => {
      calls.push(`api ${path}`);
      if (path.endsWith('/upload-url'))
        return {
          trackId: 9,
          uploadUrl: 'https://s3/put',
          headers: { 'Content-Type': 'audio/flac' },
          expiresAt: '',
        };
      void opts;
      return { id: 9 };
    }) as UploadDeps['apiFetch'],
    put: async (url, _file, headers, onProgress) => {
      calls.push(`put ${url} ${headers['Content-Type']}`);
      onProgress(0.5);
      onProgress(1);
    },
    ...over,
  };
  return { d, calls };
}

const form = { name: 'Lead', performer: 'Sam', labelIds: [3, 1] };

describe('uploadTrack', () => {
  it('decodes, requests a URL, PUTs, then confirms, in that order', async () => {
    const { d, calls } = deps();
    const track = await uploadTrack(d, { projectId: 5, file: file(), form });
    expect(calls).toEqual([
      'decode',
      'api /api/projects/5/tracks/upload-url',
      'put https://s3/put audio/flac',
      'api /api/tracks/9/confirm',
    ]);
    expect(track).toEqual({ id: 9 });
  });

  it('sends duration, size, MIME, labels and peaks computed from the audio', async () => {
    const seen: unknown[] = [];
    const { d } = deps({
      apiFetch: (async (path: string, opts?: { body?: unknown }) => {
        if (path.endsWith('/upload-url')) {
          seen.push(opts?.body);
          return {
            trackId: 9,
            uploadUrl: 'u',
            headers: { 'Content-Type': 'audio/flac' },
            expiresAt: '',
          };
        }
        return { id: 9 };
      }) as UploadDeps['apiFetch'],
    });
    await uploadTrack(d, { projectId: 5, file: file('a.flac', 'audio/flac', 5000), form });
    expect(seen[0]).toMatchObject({
      name: 'Lead',
      performer: 'Sam',
      labels: [3, 1],
      mimeType: 'audio/flac',
      sizeBytes: 5000,
      durationMs: 4000,
      startOffsetMs: 0,
      source: 'upload',
    });
    expect((seen[0] as { peaks: number[] }).peaks).toHaveLength(400); // 100 peaks/s x 4 s
  });

  it('reports progress from the PUT as a fraction', async () => {
    const { d } = deps();
    const progress: number[] = [];
    await uploadTrack(d, { projectId: 5, file: file(), form, onProgress: (f) => progress.push(f) });
    expect(progress).toContain(0.5);
    expect(progress.at(-1)).toBe(1);
  });

  it('rejects unsupported formats before touching the network', async () => {
    const { d, calls } = deps();
    await expect(
      uploadTrack(d, { projectId: 5, file: file('a.txt', 'text/plain'), form }),
    ).rejects.toThrow('Unsupported format.');
    expect(calls).toEqual([]);
  });

  it('explains files that cannot be decoded', async () => {
    const { d } = deps({
      decode: async () => {
        throw new Error('bad data');
      },
    });
    await expect(uploadTrack(d, { projectId: 5, file: file(), form })).rejects.toThrow(
      /could not be read as audio/i,
    );
  });

  it('does not confirm when the PUT fails', async () => {
    const { d, calls } = deps({
      put: async () => {
        throw new Error('PUT failed (403)');
      },
    });
    await expect(uploadTrack(d, { projectId: 5, file: file(), form })).rejects.toThrow(
      'PUT failed (403)',
    );
    expect(calls.some((c) => c.includes('/confirm'))).toBe(false);
  });

  it('cancelling aborts the PUT and never confirms (the pending track is left for cleanup)', async () => {
    const abort = new AbortController();
    const put = vi.fn(
      async (
        _u: string,
        _f: Blob,
        _h: Record<string, string>,
        _p: (f: number) => void,
        signal?: AbortSignal,
      ) => {
        await new Promise((_res, rej) =>
          signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))),
        );
      },
    );
    const { d, calls } = deps({ put });
    const p = uploadTrack(d, { projectId: 5, file: file(), form, signal: abort.signal });
    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.some((c) => c.includes('/confirm'))).toBe(false);
  });
});

describe('uploadTrack caps', () => {
  it('refuses audio longer than the cap before asking the server for a URL', async () => {
    const { d, calls } = deps({
      decode: async () => ({ durationSec: 601, sampleRate: 1, channels: [new Float32Array(601)] }),
    });
    await expect(
      uploadTrack(d, { projectId: 5, file: file(), form, caps: DEFAULT_CAPS }),
    ).rejects.toThrow('Too long (limit 10 minutes).');
    expect(calls.filter((c) => c.startsWith('api'))).toEqual([]);
  });

  it('refuses an oversized file before decoding it', async () => {
    const { d, calls } = deps();
    await expect(
      uploadTrack(d, {
        projectId: 5,
        file: file('big.wav', 'audio/wav', 61 * 1024 * 1024),
        form,
        caps: DEFAULT_CAPS,
      }),
    ).rejects.toThrow('Convert to FLAC or MP3');
    expect(calls).toEqual([]);
  });
});
