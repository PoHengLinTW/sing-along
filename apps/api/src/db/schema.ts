import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(), // incremental id: /project/:id (PRD P3)
  title: text('title').notNull(),
  artist: text('artist'),
  notes: text('notes'),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tracks = pgTable(
  'tracks',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    performer: text('performer'),
    startOffsetMs: integer('start_offset_ms').notNull().default(0),
    latencyOffsetMs: integer('latency_offset_ms').notNull().default(0),
    durationMs: integer('duration_ms').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    peaks: jsonb('peaks').$type<number[]>().notNull(),
    source: text('source', { enum: ['upload', 'recording'] }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    // pending until the client confirms the direct-to-storage upload (M1-05)
    status: text('status', { enum: ['pending', 'active'] })
      .notNull()
      .default('pending'),
    createdAt: now(),
  },
  (t) => [
    check('tracks_status_check', sql`${t.status} in ('pending', 'active')`),
    check('tracks_source_check', sql`${t.source} in ('upload', 'recording')`),
  ],
);

export const labels = pgTable(
  'labels',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    isPreset: boolean('is_preset').notNull().default(false),
  },
  (t) => [uniqueIndex('labels_name_lower_idx').on(sql`lower(${t.name})`)],
);

export const trackLabels = pgTable(
  'track_labels',
  {
    trackId: integer('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    labelId: integer('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    // Keeps label order per track: the waveform color comes from the first label (PRD L3).
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.labelId] })],
);
