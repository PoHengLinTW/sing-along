import { z } from 'zod';

/** PRD §5.9. The server reads overrides from env vars; the client learns the live values from `GET /api/storage`. */
export interface Caps {
  maxFileBytes: number;
  maxTrackMs: number;
  maxTracksPerProject: number;
  maxProjects: number;
  maxStorageBytes: number;
}

export const DEFAULT_CAPS: Caps = {
  maxFileBytes: 60 * 1024 * 1024,
  maxTrackMs: 10 * 60 * 1000,
  maxTracksPerProject: 10,
  maxProjects: 100,
  maxStorageBytes: 8 * 1024 * 1024 * 1024,
};

/** Machine-readable reason attached to a cap rejection (`ApiError.code`). */
export const ERROR_CODES = [
  'FILE_TOO_LARGE',
  'TRACK_TOO_LONG',
  'TRACK_LIMIT',
  'STORAGE_FULL',
  'PROJECT_LIMIT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const storageUsageSchema = z.object({
  /** Active tracks only (pending uploads are transient). */
  usedBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
  projectCount: z.number().int().nonnegative(),
  projectLimit: z.number().int().positive(),
  maxFileBytes: z.number().int().positive(),
  maxTrackMs: z.number().int().positive(),
  maxTracksPerProject: z.number().int().positive(),
});
export type StorageUsage = z.infer<typeof storageUsageSchema>;

const MB = 1024 * 1024;
export const formatBytes = (n: number): string => {
  if (n >= 1024 * MB) return `${+(n / (1024 * MB)).toFixed(1)} GB`;
  if (n >= MB) return `${+(n / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};
