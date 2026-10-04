import {
  type AudioUrlResponse,
  DEFAULT_CAPS,
  extensionForMime,
  isAllowedAudioType,
  type ReplaceUrlResponse,
  replaceUrlRequestSchema,
  trackOrderSchema,
  trackReplaceSchema,
  trackUpdateSchema,
  type UploadUrlResponse,
  uploadUrlRequestSchema,
} from '@sing-along/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app';
import { fileTooLarge, storageFull, trackLimit, trackTooLong } from '../caps-messages';
import { lockCaps, reservedBytes } from '../db/caps';
import { loadProject, loadTrack } from '../db/projects-repo';
import { labels, projects, trackLabels, tracks } from '../db/schema';
import { HttpError, notFound, parseId, parseInput } from '../errors';

const DEFAULT_TTL_SEC = 900;

export function registerTrackRoutes(app: FastifyInstance, deps: Deps) {
  const { db, storage } = deps;
  const caps = deps.caps ?? DEFAULT_CAPS;
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
    if (input.sizeBytes > caps.maxFileBytes) throw fileTooLarge(caps);
    if (input.durationMs > caps.maxTrackMs) throw trackTooLong(caps);
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
      await lockCaps(tx);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tracks)
        .where(eq(tracks.projectId, projectId));
      if ((count?.n ?? 0) >= caps.maxTracksPerProject) throw trackLimit(caps);
      if ((await reservedBytes(tx)) + input.sizeBytes > caps.maxStorageBytes) {
        throw storageFull(caps);
      }
      // The key contains the track id, which only exists after the insert: use a unique placeholder.
      const [row] = await tx
        .insert(tracks)
        .values({
          projectId,
          name: input.name,
          performer: input.performer,
          startOffsetMs: input.startOffsetMs,
          latencyOffsetMs: input.latencyOffsetMs,
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

  // Overwriting a track's audio (after the user edited it): upload to a NEW object, then swap the
  // row over to it in one step. The old object is deleted afterwards, so a failure at any point
  // leaves the track playing its old audio. Nothing here needs a schema change.
  app.post('/api/tracks/:id/replace-url', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = parseInput(replaceUrlRequestSchema, req.body);
    const [track] = await db
      .select({ projectId: tracks.projectId, sizeBytes: tracks.sizeBytes })
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.status, 'active')));
    if (!track) throw notFound('Track');

    const ext = extensionForMime(input.mimeType);
    if (!isAllowedAudioType(input.mimeType) || !ext) {
      throw new HttpError(415, 'Unsupported audio format');
    }
    if (input.sizeBytes > caps.maxFileBytes) throw fileTooLarge(caps);
    if (input.durationMs > caps.maxTrackMs) throw trackTooLong(caps);
    // Only the growth counts: the old file goes once the new one is in place. Checked again,
    // under the lock, when the replacement is confirmed.
    if ((await reservedBytes(db)) - track.sizeBytes + input.sizeBytes > caps.maxStorageBytes) {
      throw storageFull(caps);
    }

    const contentType = input.mimeType.split(';')[0]?.trim().toLowerCase() ?? input.mimeType;
    const key = `projects/${track.projectId}/tracks/${id}-${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await storage.presignPut({
      key,
      contentType,
      sizeBytes: input.sizeBytes,
      expiresInSec: ttl,
    });
    return {
      key,
      uploadUrl,
      headers: { 'Content-Type': contentType },
      expiresAt: expiresAt(),
    } satisfies ReplaceUrlResponse;
  });

  app.post('/api/tracks/:id/replace', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const { key, peaks, labels: labelIds, ...input } = parseInput(trackReplaceSchema, req.body);
    const { mimeType, sizeBytes, durationMs, ...fields } = input;
    const [track] = await db
      .select()
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.status, 'active')));
    if (!track) throw notFound('Track');
    if (track.storageKey === key) return loadTrack(db, id); // a repeat after a lost response

    if (!key.startsWith(`projects/${track.projectId}/tracks/${id}-`)) {
      throw new HttpError(400, 'That upload does not belong to this track');
    }
    const head = await storage.head(key);
    if (!head) throw new HttpError(400, 'Upload not found in storage');
    const discard = () => storage.deleteObjects([key]).catch(() => undefined);
    if (head.sizeBytes !== sizeBytes) {
      await discard();
      throw new HttpError(400, 'Uploaded file size does not match');
    }
    if (sizeBytes > caps.maxFileBytes) {
      await discard();
      throw fileTooLarge(caps);
    }
    if (durationMs > caps.maxTrackMs) {
      await discard();
      throw trackTooLong(caps);
    }
    const unique = labelIds ? [...new Set(labelIds)] : undefined;
    if (unique?.length) {
      const found = await db
        .select({ id: labels.id })
        .from(labels)
        .where(inArray(labels.id, unique));
      if (found.length !== unique.length) {
        await discard();
        throw new HttpError(400, 'Unknown label', { labels: 'One or more labels do not exist' });
      }
    }

    try {
      await db.transaction(async (tx) => {
        await lockCaps(tx);
        if ((await reservedBytes(tx)) - track.sizeBytes + sizeBytes > caps.maxStorageBytes) {
          throw storageFull(caps);
        }
        await tx
          .update(tracks)
          .set({
            ...fields,
            storageKey: key,
            sizeBytes,
            durationMs,
            mimeType: mimeType.split(';')[0]?.trim().toLowerCase() ?? mimeType,
            peaks,
          })
          .where(eq(tracks.id, id));
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
    } catch (err) {
      await discard();
      throw err;
    }

    try {
      await storage.deleteObjects([track.storageKey]);
    } catch (err) {
      // The row already points at the new file; the cleanup job removes the leftover object.
      req.log.error({ err, key: track.storageKey }, 'storage delete failed after audio replace');
    }
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
