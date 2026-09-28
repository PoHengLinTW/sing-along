import { buildApp } from './app';
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
const app = buildApp({ db, storage });
app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
