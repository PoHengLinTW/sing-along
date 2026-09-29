import { formatBytes } from '@sing-along/shared';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { tracks } from './db/schema';
import type { Storage } from './storage/types';

const DAY_MS = 24 * 3600_000;

export interface CleanupResult {
  pendingRemoved: number;
  orphansRemoved: number;
  bytesFreed: number;
  dryRun: boolean;
}

/**
 * Removes what an interrupted or abandoned upload leaves behind (PRD C3):
 *  - `pending` tracks older than 24 h, with their object if the upload got that far;
 *  - objects under `projects/` that no track row points to, once they are older than 24 h.
 * The 24 h margin covers the longest presigned URL (`PRESIGN_TTL_SECONDS` <= 86400) and a confirm
 * that is still on its way. Active tracks are never touched. Objects go first, rows second: if
 * storage refuses, the rows stay and the next run retries.
 */
export async function runCleanup(opts: {
  db: NodePgDatabase;
  storage: Storage;
  log: { info(message: string): void };
  now?: Date;
  dryRun?: boolean;
}): Promise<CleanupResult> {
  const { db, storage, log, dryRun = false } = opts;
  const cutoff = new Date((opts.now ?? new Date()).getTime() - DAY_MS);

  // List first, then read the DB: an object uploaded after the listing is simply not seen, while
  // an object seen without a row can only be one whose row was never created or has been deleted.
  const objects = await storage.list('projects/');
  const byKey = new Map(objects.map((o) => [o.key, o]));

  const stalePending = await db
    .select({ id: tracks.id, key: tracks.storageKey })
    .from(tracks)
    .where(and(eq(tracks.status, 'pending'), lt(tracks.createdAt, cutoff)));
  const knownKeys = new Set(
    (await db.select({ key: tracks.storageKey }).from(tracks)).map((r) => r.key),
  );

  const orphans = objects.filter((o) => !knownKeys.has(o.key) && o.lastModified < cutoff);
  const pendingObjects = stalePending.flatMap((t) => byKey.get(t.key) ?? []);

  const bytesFreed = [...pendingObjects, ...orphans].reduce((sum, o) => sum + o.sizeBytes, 0);
  const result: CleanupResult = {
    pendingRemoved: stalePending.length,
    orphansRemoved: orphans.length,
    bytesFreed,
    dryRun,
  };

  if (!dryRun) {
    await storage.deleteObjects([...pendingObjects, ...orphans].map((o) => o.key));
    if (stalePending.length) {
      await db.delete(tracks).where(
        and(
          inArray(
            tracks.id,
            stalePending.map((t) => t.id),
          ),
          eq(tracks.status, 'pending'),
        ),
      );
    }
  }

  const summary = `pending removed: ${result.pendingRemoved}, orphans removed: ${result.orphansRemoved}, freed: ${formatBytes(bytesFreed)}`;
  log.info(
    dryRun ? `Cleanup (dry run, nothing deleted) would remove: ${summary}` : `Cleanup: ${summary}`,
  );
  if (dryRun) {
    for (const t of stalePending) log.info(`  pending track ${t.id}: ${t.key}`);
    for (const o of orphans) log.info(`  orphan object: ${o.key} (${formatBytes(o.sizeBytes)})`);
  }
  return result;
}
