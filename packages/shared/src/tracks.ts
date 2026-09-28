import { z } from 'zod';

/** PRD T1: mp3, m4a/aac, wav, ogg, webm/opus, flac. Keyed by base MIME type. */
const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

const baseType = (mime: string) => (mime.split(';')[0] ?? '').trim().toLowerCase();

export const isAllowedAudioType = (mime: string) => baseType(mime) in EXTENSIONS;
export const extensionForMime = (mime: string): string | undefined => EXTENSIONS[baseType(mime)];

export const OFFSET_MAX_MS = 600_000;
export const PEAKS_MAX_LENGTH = 100_000; // 100/s x 10 min = 60k, with headroom

export const uploadUrlRequestSchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name must be at most 200 characters'),
  performer: z
    .string()
    .trim()
    .max(100)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null),
  labels: z.array(z.number().int().positive()).max(20).default([]),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  startOffsetMs: z.number().int().min(-OFFSET_MAX_MS).max(OFFSET_MAX_MS).default(0),
  source: z.enum(['upload', 'recording']),
  peaks: z.array(z.number().min(0).max(1)).max(PEAKS_MAX_LENGTH),
});
export type UploadUrlRequest = z.input<typeof uploadUrlRequestSchema>;

export const uploadUrlResponseSchema = z.object({
  trackId: z.number().int(),
  uploadUrl: z.string(),
  /** Headers the browser must send with the PUT. Content-Length is set by the browser itself. */
  headers: z.object({ 'Content-Type': z.string() }),
  expiresAt: z.string(),
});
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;

export const audioUrlResponseSchema = z.object({ url: z.string(), expiresAt: z.string() });
export type AudioUrlResponse = z.infer<typeof audioUrlResponseSchema>;

export const trackUpdateSchema = z
  .object({
    name: uploadUrlRequestSchema.shape.name,
    performer: z
      .string()
      .trim()
      .max(100)
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    labels: z.array(z.number().int().positive()).max(20),
    startOffsetMs: z.number().int().min(-OFFSET_MAX_MS).max(OFFSET_MAX_MS),
    latencyOffsetMs: z.number().int().min(-OFFSET_MAX_MS).max(OFFSET_MAX_MS),
  })
  .partial();
export type TrackUpdate = z.infer<typeof trackUpdateSchema>;

export const trackOrderSchema = z.object({ trackIds: z.array(z.number().int().positive()) });
export type TrackOrder = z.infer<typeof trackOrderSchema>;

export const LABEL_NAME_MAX = 30;
export const labelCreateSchema = z.object({
  name: z
    .string({ error: 'Label name is required' })
    .trim()
    .min(1, 'Label name is required')
    .max(LABEL_NAME_MAX, `Label name must be at most ${LABEL_NAME_MAX} characters`),
});
export type LabelCreate = z.infer<typeof labelCreateSchema>;
