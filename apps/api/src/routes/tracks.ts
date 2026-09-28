import {
  type AudioUrlResponse,
  extensionForMime,
  isAllowedAudioType,
  type UploadUrlResponse,
  uploadUrlRequestSchema,
} from '@sing-along/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app';
import { loadTrack } from '../db/projects-repo';
import { labels, projects, trackLabels, tracks } from '../db/schema';
import { HttpError, notFound, parseId, parseInput } from '../errors';

const DEFAULT_TTL_SEC = 900;

export function registerTrackRoutes(app: FastifyInstance, deps: Deps) {
  const { db, storage } = deps;
  const ttl = deps.presignTtlSec ?? DEFAULT_TTL_SEC;
  const expiresAt = () => new Date(Date.now() + ttl * 1000).toISOString();

  app.post('/api/projects/:id/tracks/upload-url', async (req, reply) => {
    const projectId = parseId((req.params as { id: string }).id);
    const input = parseInput(uploadUrlRequestSchema, req.body);
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) throw notFound('Project');

    const ext = extensionForMime(input.mimeType);
    if (!isAllowedAudioType(input.mimeType) || !ext) {
      throw new HttpError(415, 'Unsupported audio format');
    }
    if (input.labels.length) {
      const found = await db
        .select({ id: labels.id })
        .from(labels)
        .where(inArray(labels.id, input.labels));
      if (found.length !== new Set(input.labels).size) {
        throw new HttpError(400, 'Unknown label', { labels: 'One or more labels do not exist' });
      }
    }

    const contentType = input.mimeType.split(';')[0]?.trim().toLowerCase() ?? input.mimeType;
    const trackId = await db.transaction(async (tx) => {
      // The key contains the track id, which only exists after the insert: use a unique placeholder.
      const [row] = await tx
        .insert(tracks)
        .values({
          projectId,
          name: input.name,
          performer: input.performer,
          startOffsetMs: input.startOffsetMs,
          durationMs: input.durationMs,
          mimeType: contentType,
          sizeBytes: input.sizeBytes,
          storageKey: `pending/${crypto.randomUUID()}`,
          peaks: input.peaks,
          source: input.source,
        })
        .returning({ id: tracks.id });
      if (!row) throw new Error('insert returned no row');
      await tx
        .update(tracks)
        .set({ storageKey: `projects/${projectId}/tracks/${row.id}.${ext}` })
        .where(eq(tracks.id, row.id));
      const unique = [...new Set(input.labels)];
      if (unique.length) {
        await tx
          .insert(trackLabels)
          .values(unique.map((labelId, position) => ({ trackId: row.id, labelId, position })));
      }
      return row.id;
    });

    const [track] = await db
      .select({ key: tracks.storageKey })
      .from(tracks)
      .where(eq(tracks.id, trackId));
    const uploadUrl = await storage.presignPut({
      key: track?.key ?? '',
      contentType,
      sizeBytes: input.sizeBytes,
      expiresInSec: ttl,
    });
    const body: UploadUrlResponse = {
      trackId,
      uploadUrl,
      headers: { 'Content-Type': contentType },
      expiresAt: expiresAt(),
    };
    return reply.status(201).send(body);
  });

  app.post('/api/tracks/:id/confirm', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const [track] = await db.select().from(tracks).where(eq(tracks.id, id));
    if (!track) throw notFound('Track');
    if (track.status === 'active') return loadTrack(db, id);

    const head = await storage.head(track.storageKey);
    if (!head || head.sizeBytes !== track.sizeBytes) {
      // A bad upload can't be retried under the same URL: drop the object and the pending row.
      if (head) await storage.deleteObjects([track.storageKey]).catch(() => undefined);
      await db.delete(tracks).where(eq(tracks.id, id));
      throw new HttpError(
        400,
        head ? 'Uploaded file size does not match' : 'Upload not found in storage',
      );
    }

    await db.transaction(async (tx) => {
      const [max] = await tx
        .select({ n: sql<number>`coalesce(max(${tracks.sortOrder}), -1)::int` })
        .from(tracks)
        .where(and(eq(tracks.projectId, track.projectId), eq(tracks.status, 'active')));
      await tx
        .update(tracks)
        .set({ status: 'active', sortOrder: (max?.n ?? -1) + 1 })
        .where(eq(tracks.id, id));
      await tx
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, track.projectId));
    });
    return loadTrack(db, id);
  });

  app.get('/api/tracks/:id/audio-url', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const [track] = await db
      .select({ key: tracks.storageKey })
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.status, 'active')));
    if (!track) throw notFound('Track');
    const url = await storage.presignGet({ key: track.key, expiresInSec: ttl });
    return { url, expiresAt: expiresAt() } satisfies AudioUrlResponse;
  });
}
