import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { labels } from './schema';

// PRD L2 presets. Colors are distinct enough to tell chips and waveforms apart.
export const PRESET_LABELS = [
  { name: 'Instrumental/Backing', color: '#64748b' },
  { name: 'Vocal', color: '#3b82f6' },
  { name: 'Lead', color: '#ef4444' },
  { name: 'Harmony', color: '#a855f7' },
  { name: 'Soprano', color: '#ec4899' },
  { name: 'Alto', color: '#f97316' },
  { name: 'Tenor', color: '#eab308' },
  { name: 'Bass', color: '#22c55e' },
  { name: 'Guitar', color: '#14b8a6' },
  { name: 'Piano', color: '#06b6d4' },
  { name: 'Drums', color: '#84cc16' },
  { name: 'Other', color: '#9ca3af' },
] as const;

/** Idempotent: safe on every boot; existing labels (even edited or custom) are left alone. */
export async function seedLabels(db: NodePgDatabase): Promise<void> {
  await db
    .insert(labels)
    .values(PRESET_LABELS.map((l) => ({ ...l, isPreset: true })))
    // No conflict target: names are unique on lower(name), which drizzle can't name as a target.
    .onConflictDoNothing();
}
