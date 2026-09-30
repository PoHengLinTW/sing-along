export interface PreflightResponse {
  status: number;
  headers: Headers;
}

export interface CorsResult {
  origin: string;
  expectAllowed: boolean;
  problems: string[];
}

const NEEDED_METHODS = ['GET', 'PUT', 'HEAD'];

const listOf = (value: string | null) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

/**
 * Judges the answer to a CORS preflight (OPTIONS) sent with `Origin: <origin>`.
 * The app's own origin must be allowed for GET, PUT and HEAD with a Content-Type header (the
 * browser uploads and downloads audio straight to storage); any other origin must be refused.
 */
export function evaluatePreflight(
  origin: string,
  expectAllowed: boolean,
  res: PreflightResponse,
): CorsResult {
  const problems: string[] = [];
  const allowOrigin = res.headers.get('access-control-allow-origin');
  const allowsOrigin = allowOrigin === origin || allowOrigin === '*';

  if (!expectAllowed) {
    if (allowsOrigin) {
      problems.push(
        `Origin ${origin} must be rejected but storage answered access-control-allow-origin: ${allowOrigin}`,
      );
    }
    return { origin, expectAllowed, problems };
  }

  if (res.status < 200 || res.status >= 300) {
    problems.push(`Preflight for ${origin} answered HTTP ${res.status}`);
  }
  if (!allowsOrigin) {
    problems.push(
      `Storage does not allow the origin ${origin} (access-control-allow-origin: ${allowOrigin ?? 'missing'})`,
    );
  }
  const methods = listOf(res.headers.get('access-control-allow-methods'));
  if (!methods.includes('*')) {
    for (const m of NEEDED_METHODS) {
      if (!methods.includes(m.toLowerCase())) problems.push(`Method ${m} is not allowed`);
    }
  }
  const headers = listOf(res.headers.get('access-control-allow-headers'));
  if (!headers.includes('*') && !headers.includes('content-type')) {
    problems.push('Header Content-Type is not allowed');
  }
  return { origin, expectAllowed, problems };
}
