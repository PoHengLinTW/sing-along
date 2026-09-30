import { runCleanup } from './cleanup';
import { ConfigError, loadConfig } from './config';
import { createDb } from './db/client';
import { createS3Client, S3Storage } from './storage/s3';

// `pnpm cleanup [--dry-run]`: one cleanup run against the configured database and bucket.
const dryRun = process.argv.includes('--dry-run');

try {
  const config = loadConfig();
  const { db, pool } = createDb(config.databaseUrl);
  const storage = new S3Storage(createS3Client(config.s3), config.s3.bucket);
  await runCleanup({ db, storage, dryRun, log: { info: (m) => console.log(m) } });
  await pool.end();
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
