import { type Caps, formatBytes } from '@sing-along/shared';
import { HttpError } from './errors';

const minutes = (ms: number) => `${+(ms / 60000).toFixed(1)} minutes`;

export const fileTooLarge = (c: Caps) =>
  new HttpError(
    413,
    `File is too large (limit ${formatBytes(c.maxFileBytes)}). Convert WAV to FLAC or MP3 to make it smaller.`,
    { sizeBytes: 'Too large' },
    'FILE_TOO_LARGE',
  );

export const trackTooLong = (c: Caps) =>
  new HttpError(
    422,
    `Track is too long (limit ${minutes(c.maxTrackMs)}).`,
    { durationMs: 'Too long' },
    'TRACK_TOO_LONG',
  );

export const trackLimit = (c: Caps) =>
  new HttpError(
    409,
    `Track limit reached (${c.maxTracksPerProject}). Delete a track to add another.`,
    undefined,
    'TRACK_LIMIT',
  );

export const storageFull = (c: Caps) =>
  new HttpError(
    507,
    `Storage full (${formatBytes(c.maxStorageBytes)}) — delete old tracks or projects.`,
    undefined,
    'STORAGE_FULL',
  );

export const projectLimit = (c: Caps) =>
  new HttpError(
    409,
    `Project limit reached (${c.maxProjects}). Delete a project to create another.`,
    undefined,
    'PROJECT_LIMIT',
  );
