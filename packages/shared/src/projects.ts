import { z } from 'zod';
import { ERROR_CODES } from './caps';

const TITLE_MAX = 200;
const ARTIST_MAX = 200;
const NOTES_MAX = 5000;

/** Optional free text: trimmed, and empty means "no value" (null), so clearing a field works. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const title = z
  .string({ error: 'Title is required' })
  .trim()
  .min(1, 'Title is required')
  .max(TITLE_MAX, `Title must be at most ${TITLE_MAX} characters`);

export const projectCreateSchema = z.object({
  title,
  artist: optionalText(ARTIST_MAX).optional(),
  notes: optionalText(NOTES_MAX).optional(),
});
export type ProjectCreate = z.infer<typeof projectCreateSchema>;

export const projectUpdateSchema = projectCreateSchema.partial();
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

export const labelSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string(),
  isPreset: z.boolean(),
});
export type LabelDto = z.infer<typeof labelSchema>;

export const trackSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  name: z.string(),
  performer: z.string().nullable(),
  labels: z.array(labelSchema),
  startOffsetMs: z.number().int(),
  latencyOffsetMs: z.number().int(),
  durationMs: z.number().int(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  source: z.enum(['upload', 'recording']),
  sortOrder: z.number().int(),
  peaks: z.array(z.number()),
  createdAt: z.string(),
});
export type TrackDto = z.infer<typeof trackSchema>;

export const projectListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  artist: z.string().nullable(),
  trackCount: z.number().int(),
  updatedAt: z.string(),
});
export type ProjectListItem = z.infer<typeof projectListItemSchema>;

export const projectDetailSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  artist: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tracks: z.array(trackSchema),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

/** Error body for every non-2xx response: `message` is shown in a toast, `fields` marks form fields. */
export const apiErrorSchema = z.object({
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  code: z.enum(ERROR_CODES).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
