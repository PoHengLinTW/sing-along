// Starts the production build of the app for the E2E run, against the compose stack
// (docker-compose.dev.yml: Postgres on 5433, RustFS on 9000). It uses its own database and bucket,
// recreated empty every run, so tests never touch dev data and never see leftovers.
// Needs `pnpm build` first (apps/api/dist and apps/web/dist).
import { fileURLToPath } from 'node:url';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = process.env.E2E_PORT ?? '3300';
const DB = 'singalong_e2e';
const BUCKET = 'sing-along-e2e';
const PG_ADMIN =
  process.env.E2E_PG_ADMIN_URL ?? 'postgres://singalong:singalong@localhost:5433/postgres';
const S3 = {
  endpoint: process.env.E2E_S3_ENDPOINT ?? 'http://localhost:9000',
  accessKeyId: process.env.E2E_S3_KEY ?? 'minioadmin',
  secretAccessKey: process.env.E2E_S3_SECRET ?? 'minioadmin',
};

const admin = new pg.Client({ connectionString: PG_ADMIN });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DB}`);
await admin.end();

const s3 = new S3Client({
  region: 'auto',
  endpoint: S3.endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey },
});
try {
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
} catch (err) {
  if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(String(err?.name ?? err))) throw err;
}
for (;;) {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
  if (!keys.length) break;
  await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
}

const dbUrl = new URL(PG_ADMIN);
dbUrl.pathname = `/${DB}`;
Object.assign(process.env, {
  PORT,
  DATABASE_URL: dbUrl.toString(),
  S3_ENDPOINT: S3.endpoint,
  S3_REGION: 'auto',
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: S3.accessKeyId,
  S3_SECRET_ACCESS_KEY: S3.secretAccessKey,
  S3_FORCE_PATH_STYLE: 'true',
  PUBLIC_ORIGIN: `http://localhost:${PORT}`,
  WEB_DIST_DIR: `${root}apps/web/dist`,
  MIGRATIONS_DIR: `${root}apps/api/drizzle`,
  CLEANUP_CRON: 'off',
});
await import(`${root}apps/api/dist/server.js`);
