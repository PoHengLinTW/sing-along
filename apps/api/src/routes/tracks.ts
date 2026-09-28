import {
  type AudioUrlResponse,
  extensionForMime,
  isAllowedAudioType,
  trackOrderSchema,
  trackUpdateSchema,
  type UploadUrlResponse,
  uploadUrlRequestSchema,
} from '@sing-along/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app';
import { loadProject, loadTrack } from '../db/projects-repo';
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

  app.patch('/api/tracks/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const { labels: labelIds, ...fields } = parseInput(trackUpdateSchema, req.body);
    const [track] = await db
      .select({ projectId: tracks.projectId })
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.status, 'active')));
    if (!track) throw notFound('Track');

    const unique = labelIds ? [...new Set(labelIds)] : undefined;
    if (unique?.length) {
      const found = await db
        .select({ id: labels.id })
        .from(labels)
        .where(inArray(labels.id, unique));
      if (found.length !== unique.length) {
        throw new HttpError(400, 'Unknown label', { labels: 'One or more labels do not exist' });
      }
    }

    await db.transaction(async (tx) => {
      if (Object.keys(fields).length) await tx.update(tracks).set(fields).where(eq(tracks.id, id));
      if (unique) {
        await tx.delete(trackLabels).where(eq(trackLabels.trackId, id));
        if (unique.length) {
          await tx
            .insert(trackLabels)
            .values(unique.map((labelId, position) => ({ trackId: id, labelId, position })));
        }
      }
      await tx
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, track.projectId));
    });
    return loadTrack(db, id);
  });

  app.delete('/api/tracks/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    const [row] = await db
      .delete(tracks)
      .where(eq(tracks.id, id))
      .returning({ key: tracks.storageKey, projectId: tracks.projectId });
    if (!row) throw notFound('Track');
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, row.projectId));
    try {
      await storage.deleteObjects([row.key]);
    } catch (err) {
      // DB is the source of truth; the M3 orphan cleanup removes the leftover object.
      req.log.error({ err, key: row.key }, 'storage delete failed after track delete');
    }
    return reply.status(204).send();
  });

  app.put('/api/projects/:id/track-order', async (req) => {
    const projectId = parseId((req.params as { id: string }).id);
    const { trackIds } = parseInput(trackOrderSchema, req.body);
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) throw notFound('Project');

    const current = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.projectId, projectId), eq(tracks.status, 'active')));
    const expected = new Set(current.map((r) => r.id));
    const given = new Set(trackIds);
    if (
      given.size !== trackIds.length ||
      given.size !== expected.size ||
      trackIds.some((x) => !expected.has(x))
    ) {
      throw new HttpError(400, 'Track order must list every track in this project exactly once', {
        trackIds: 'Must contain every track of this project exactly once',
      });
    }

    await db.transaction(async (tx) => {
      for (const [index, trackId] of trackIds.entries()) {
        await tx.update(tracks).set({ sortOrder: index }).where(eq(tracks.id, trackId));
      }
      await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    });
    return loadProject(db, projectId);
  });
}
