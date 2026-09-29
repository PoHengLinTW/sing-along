import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { putWithProgress } from './put';

class FakeXHR {
  static last: FakeXHR;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  aborted = false;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const original = globalThis.XMLHttpRequest;
beforeEach(() => {
  globalThis.XMLHttpRequest = FakeXHR as never;
});
afterEach(() => {
  globalThis.XMLHttpRequest = original;
});

const file = new File([new Uint8Array(10)], 'a.flac', { type: 'audio/flac' });

describe('putWithProgress', () => {
  it('PUTs the file with the given headers and reports progress as a fraction', async () => {
    const seen: number[] = [];
    const p = putWithProgress('https://s3/put', file, { 'Content-Type': 'audio/flac' }, (f) =>
      seen.push(f),
    );
    const x = FakeXHR.last;
    expect(x.method).toBe('PUT');
    expect(x.url).toBe('https://s3/put');
    expect(x.headers['Content-Type']).toBe('audio/flac');
    expect(x.body).toBe(file);
    x.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    x.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    x.status = 200;
    x.onload?.();
    await p;
    expect(seen).toEqual([0.5, 1]);
  });

  it('rejects with the status when storage refuses the upload', async () => {
    const p = putWithProgress('u', file, {}, () => {});
    FakeXHR.last.status = 403;
    FakeXHR.last.onload?.();
    await expect(p).rejects.toThrow('Upload failed (403)');
  });

  it('rejects on a network error', async () => {
    const p = putWithProgress('u', file, {}, () => {});
    FakeXHR.last.onerror?.();
    await expect(p).rejects.toThrow("Can't reach storage.");
  });

  it('aborts when the signal fires and rejects with AbortError', async () => {
    const ctl = new AbortController();
    const p = putWithProgress('u', file, {}, () => {}, ctl.signal);
    ctl.abort();
    expect(FakeXHR.last.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately if already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(putWithProgress('u', file, {}, () => {}, ctl.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
