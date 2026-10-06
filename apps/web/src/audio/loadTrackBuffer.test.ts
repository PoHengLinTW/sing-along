import { describe, expect, it, vi } from 'vitest';
import { createBufferLoader } from './loadTrackBuffer';

const setup = (over: { ok?: boolean } = {}) => {
  const api = vi.fn(async () => ({ url: 'https://s3/get', expiresAt: '' }));
  const download = vi.fn(async (_url: string) =>
    over.ok === false ? new Response('no', { status: 403 }) : new Response(new ArrayBuffer(4)),
  );
  const decode = vi.fn(async () => ({ duration: 3 }) as unknown as AudioBuffer);
  return { api, download, decode, load: createBufferLoader({ api, download, decode } as never) };
};

describe('createBufferLoader', () => {
  it('gets a presigned URL, downloads, and decodes', async () => {
    const s = setup();
    const buf = await s.load(7);
    expect(s.api).toHaveBeenCalledWith('/api/tracks/7/audio-url');
    expect(s.download).toHaveBeenCalledWith('https://s3/get');
    expect(buf.duration).toBe(3);
  });

  it('caches by track id: tracks are immutable, so a buffer is never fetched twice', async () => {
    const s = setup();
    await s.load(7);
    await s.load(7);
    expect(s.download).toHaveBeenCalledTimes(1);
    expect(s.decode).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight download between concurrent callers', async () => {
    const s = setup();
    await Promise.all([s.load(7), s.load(7)]);
    expect(s.download).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures, so a retry can succeed', async () => {
    const s = setup({ ok: false });
    await expect(s.load(7)).rejects.toThrow(/403/);
    s.download.mockResolvedValueOnce(new Response(new ArrayBuffer(4)));
    await expect(s.load(7)).resolves.toBeTruthy();
  });
});

describe('createBufferLoader: expired presigned URLs', () => {
  const fresh = () => new Response(new ArrayBuffer(4));

  it('asks for a fresh URL and retries once when the download is refused (expired signature)', async () => {
    const s = setup();
    s.api
      .mockResolvedValueOnce({ url: 'https://s3/old', expiresAt: '' })
      .mockResolvedValueOnce({ url: 'https://s3/new', expiresAt: '' });
    s.download
      .mockResolvedValueOnce(new Response('expired', { status: 403 }))
      .mockResolvedValueOnce(fresh());
    await expect(s.load(7)).resolves.toBeTruthy();
    expect(s.api).toHaveBeenCalledTimes(2);
    expect(s.download.mock.calls.map((c) => c[0])).toEqual(['https://s3/old', 'https://s3/new']);
  });

  it('gives up after that one retry', async () => {
    const s = setup({ ok: false });
    await expect(s.load(7)).rejects.toThrow(/403/);
    expect(s.download).toHaveBeenCalledTimes(2);
  });

  it.each([404, 500, 503])('does not retry a %s (a fresh URL would not help)', async (status) => {
    const s = setup();
    s.download.mockResolvedValue(new Response('x', { status }));
    await expect(s.load(7)).rejects.toThrow(String(status));
    expect(s.download).toHaveBeenCalledTimes(1);
  });
});

describe('createBufferLoader: a track whose audio was overwritten', () => {
  it('fetches again when the version changes, because the saved audio is no longer the same', async () => {
    const s = setup();
    await s.load(7, 'v1');
    await s.load(7, 'v2');
    expect(s.download).toHaveBeenCalledTimes(2);
  });

  it('still caches for the same version', async () => {
    const s = setup();
    await s.load(7, 'v1');
    await s.load(7, 'v1');
    expect(s.download).toHaveBeenCalledTimes(1);
  });

  it('does not keep the old audio once newer audio was asked for', async () => {
    const s = setup();
    await s.load(7, 'v1');
    await s.load(7, 'v2');
    await s.load(7, 'v1'); // the old one is gone: it has to be fetched again
    expect(s.download).toHaveBeenCalledTimes(3);
  });

  it('keeps tracks apart', async () => {
    const s = setup();
    await s.load(7, 'v1');
    await s.load(8, 'v1');
    await s.load(7, 'v1');
    expect(s.download).toHaveBeenCalledTimes(2);
  });

  it('without a version it behaves as before', async () => {
    const s = setup();
    await s.load(7);
    await s.load(7);
    expect(s.download).toHaveBeenCalledTimes(1);
  });
});
