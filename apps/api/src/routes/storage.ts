import { DEFAULT_CAPS, type StorageUsage } from '@sing-along/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app';
import { projects, tracks } from '../db/schema';

export function registerStorageRoutes(app: FastifyInstance, { db, caps = DEFAULT_CAPS }: Deps) {
  app.get('/api/storage', async (): Promise<StorageUsage> => {
    const [used] = await db
      .select({ n: sql<number>`coalesce(sum(${tracks.sizeBytes}), 0)::float8` })
      .from(tracks)
      .where(eq(tracks.status, 'active'));
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
    return {
      usedBytes: used?.n ?? 0,
      limitBytes: caps.maxStorageBytes,
      projectCount: count?.n ?? 0,
      projectLimit: caps.maxProjects,
      maxFileBytes: caps.maxFileBytes,
      maxTrackMs: caps.maxTrackMs,
      maxTracksPerProject: caps.maxTracksPerProject,
    };
  });
}
