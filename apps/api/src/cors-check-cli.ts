import { ConfigError, loadConfig } from './config';
import { evaluatePreflight } from './cors-check';
import { createS3Client, S3Storage } from './storage/s3';

// `pnpm check:cors [--origin https://app] [--other https://foreign]`
// Sends real CORS preflights to the configured bucket: the app origin must be allowed, another
// origin must be refused. Nothing is uploaded and no credentials are sent with the preflight.
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  const config = loadConfig();
  const storage = new S3Storage(createS3Client(config.s3), config.s3.bucket);
  const appOrigin = arg('--origin') ?? config.publicOrigin;
  const otherOrigin = arg('--other') ?? 'https://cors-check.invalid';
  // The same kind of URL the app hands to the browser, so host style and bucket match.
  const url = await storage.presignPut({
    key: `cors-check/${Date.now()}.flac`,
    contentType: 'audio/flac',
    sizeBytes: 1,
    expiresInSec: 60,
  });

  let failed = false;
  for (const [origin, expectAllowed] of [
    [appOrigin, true],
    [otherOrigin, false],
  ] as const) {
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const { problems } = evaluatePreflight(origin, expectAllowed, res);
    console.log(
      `${problems.length ? 'FAIL' : 'ok  '} ${expectAllowed ? 'allowed' : 'refused'}: ${origin}`,
    );
    for (const p of problems) console.log(`       - ${p}`);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
