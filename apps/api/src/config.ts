import type { Caps } from '@sing-along/shared';
import { z } from 'zod';

const positive = (def: number) => z.coerce.number().positive().default(def);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PUBLIC_ORIGIN: z.url(),
  // Storage caps (PRD §5.9)
  MAX_FILE_MB: positive(60),
  MAX_TRACK_MINUTES: positive(10),
  MAX_TRACKS_PER_PROJECT: z.coerce.number().int().positive().default(10),
  MAX_PROJECTS: z.coerce.number().int().positive().default(100),
  MAX_STORAGE_GB: positive(8),
  PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
});

export interface Config {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  publicOrigin: string;
  presignTtlSec: number;
  caps: Caps;
}

export class ConfigError extends Error {}

/** Validates the environment once at startup so a bad deploy fails loudly, not on first request. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => {
      const name = i.path.join('.');
      const missing = env[name] === undefined;
      return `  - ${name}: ${missing ? 'missing' : i.message}`;
    });
    throw new ConfigError(
      `Invalid environment configuration:\n${lines.join('\n')}\nSee .env.example for every variable.`,
    );
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    },
    publicOrigin: e.PUBLIC_ORIGIN,
    presignTtlSec: e.PRESIGN_TTL_SECONDS,
    caps: {
      maxFileBytes: Math.floor(e.MAX_FILE_MB * 1024 * 1024),
      maxTrackMs: Math.floor(e.MAX_TRACK_MINUTES * 60_000),
      maxTracksPerProject: e.MAX_TRACKS_PER_PROJECT,
      maxProjects: e.MAX_PROJECTS,
      maxStorageBytes: Math.floor(e.MAX_STORAGE_GB * 1024 ** 3),
    },
  };
}
