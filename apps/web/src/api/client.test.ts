import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiFetch } from './client';

const mockFetch = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch(async () => json(200, { a: 1 }));
    expect(await apiFetch('/api/x')).toEqual({ a: 1 });
  });

  it('sends JSON bodies with the right header', async () => {
    const f = vi.fn(async () => json(201, { ok: true }));
    vi.stubGlobal('fetch', f);
    await apiFetch('/api/x', { method: 'POST', body: { title: 't' } });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"title":"t"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('returns undefined for 204', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    expect(await apiFetch('/api/x', { method: 'DELETE' })).toBeUndefined();
  });

  it("throws ApiRequestError with the server's message and field errors", async () => {
    mockFetch(async () =>
      json(400, { message: 'Title is required', fields: { title: 'Title is required' } }),
    );
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Title is required');
    expect(err.fields).toEqual({ title: 'Title is required' });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    mockFetch(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiRequestError;
    expect(err.status).toBe(502);
    expect(err.message).toBe('Request failed (502)');
  });

  it('turns a network failure into "Can\'t reach server."', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(0);
    expect(err.message).toBe("Can't reach server.");
  });
});
