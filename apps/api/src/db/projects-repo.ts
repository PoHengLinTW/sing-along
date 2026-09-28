import type { ProjectDetail, ProjectListItem, TrackDto } from '@sing-along/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { labels, projects, trackLabels, tracks } from './schema';

type Db = NodePgDatabase;

export async function listProjects(db: Db): Promise<ProjectListItem[]> {
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      artist: projects.artist,
      updatedAt: projects.updatedAt,
      trackCount: sql<number>`count(${tracks.id}) filter (where ${tracks.status} = 'active')::int`,
    })
    .from(projects)
    .leftJoin(tracks, eq(tracks.projectId, projects.id))
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt), desc(projects.id));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function loadProject(db: Db, id: number): Promise<ProjectDetail | null> {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) return null;

  const trackRows = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.projectId, id), eq(tracks.status, 'active')))
    .orderBy(asc(tracks.sortOrder), asc(tracks.id));

  const labelRows = trackRows.length
    ? await db
        .select({ trackId: trackLabels.trackId, position: trackLabels.position, label: labels })
        .from(trackLabels)
        .innerJoin(labels, eq(labels.id, trackLabels.labelId))
        .where(
          inArray(
            trackLabels.trackId,
            trackRows.map((t) => t.id),
          ),
        )
        .orderBy(asc(trackLabels.position))
    : [];

  const byTrack = new Map<number, TrackDto['labels']>();
  for (const r of labelRows) {
    const list = byTrack.get(r.trackId) ?? [];
    list.push(r.label);
    byTrack.set(r.trackId, list);
  }

  return {
    id: p.id,
    title: p.title,
    artist: p.artist,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    tracks: trackRows.map((t) => toTrackDto(t, byTrack.get(t.id) ?? [])),
  };
}

export function toTrackDto(
  t: typeof tracks.$inferSelect,
  trackLabelsList: TrackDto['labels'],
): TrackDto {
  return {
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    performer: t.performer,
    labels: trackLabelsList,
    startOffsetMs: t.startOffsetMs,
    latencyOffsetMs: t.latencyOffsetMs,
    durationMs: t.durationMs,
    mimeType: t.mimeType,
    sizeBytes: t.sizeBytes,
    source: t.source,
    sortOrder: t.sortOrder,
    peaks: t.peaks,
    createdAt: t.createdAt.toISOString(),
  };
}

export async function loadTrack(db: Db, id: number): Promise<TrackDto | null> {
  const [t] = await db.select().from(tracks).where(eq(tracks.id, id));
  if (!t) return null;
  const rows = await db
    .select({ label: labels })
    .from(trackLabels)
    .innerJoin(labels, eq(labels.id, trackLabels.labelId))
    .where(eq(trackLabels.trackId, id))
    .orderBy(asc(trackLabels.position));
  return toTrackDto(
    t,
    rows.map((r) => r.label),
  );
}
