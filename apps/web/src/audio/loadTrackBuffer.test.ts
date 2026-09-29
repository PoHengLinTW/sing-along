import { describe, expect, it, vi } from 'vitest';
import { createBufferLoader } from './loadTrackBuffer';

const setup = (over: { ok?: boolean } = {}) => {
  const api = vi.fn(async () => ({ url: 'https://s3/get', expiresAt: '' }));
  const download = vi.fn(async () =>
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
