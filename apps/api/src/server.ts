import { buildApp } from './app';
import { runCleanup } from './cleanup';
import { scheduleCleanup } from './cleanup-schedule';
import { type Config, ConfigError, loadConfig } from './config';
import { createDb } from './db/client';
import { createS3Client, S3Storage } from './storage/s3';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const { db } = createDb(config.databaseUrl);
const storage = new S3Storage(createS3Client(config.s3), config.s3.bucket);
const app = buildApp({ db, storage, presignTtlSec: config.presignTtlSec, caps: config.caps });
const cleanup = scheduleCleanup(
  config.cleanupCron,
  () => runCleanup({ db, storage, log: { info: (m) => console.log(m) } }),
  { error: (m) => console.error(m) },
);
if (cleanup)
  console.log(
    `Cleanup scheduled (${config.cleanupCron}); next run ${cleanup.nextRun()?.toISOString()}`,
  );

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
