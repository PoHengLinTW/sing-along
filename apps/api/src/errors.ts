import type { ApiError } from '@sing-along/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** Validates input with a shared zod schema; failures become a 400 with one message per field. */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'body';
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, Object.values(fields)[0] ?? 'Invalid request', fields);
}

/** Path ids are incremental integers; anything else is simply "not found". */
export function parseId(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) throw notFound('Resource');
  return Number(raw);
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      const body: ApiError = {
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      };
      return reply.status(err.status).send(body);
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ message: (err as Error).message } satisfies ApiError);
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ message: 'Something went wrong on the server.' } satisfies ApiError);
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ message: 'Not found' } satisfies ApiError),
  );
}
