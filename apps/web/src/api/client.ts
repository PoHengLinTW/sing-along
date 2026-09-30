import type { ApiError, ErrorCode } from '@sing-along/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number, // 0 = the server could not be reached
    message: string,
    readonly fields?: Record<string, string>,
    readonly code?: ErrorCode,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** Thin typed fetch wrapper: JSON in/out, and every failure becomes an ApiRequestError with a user-facing message. */
export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      signal: opts.signal,
      headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiRequestError(0, "Can't reach server.");
  }

  if (!res.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = (await res.json()) as Partial<ApiError>;
    } catch {
      /* not JSON (e.g. a proxy error page) */
    }
    throw new ApiRequestError(
      res.status,
      body.message ?? `Request failed (${res.status})`,
      body.fields,
      body.code,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
