import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { tracks } from './schema';

type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Arbitrary constant: every cap check + insert takes this one lock, so two requests cannot both
// read "room left" and then both insert. A single-user homelab app never contends on it for long.
const CAPS_LOCK_KEY = 7_301_001;

/** Serialises cap checks with their inserts until the surrounding transaction ends. */
export const lockCaps = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(${CAPS_LOCK_KEY})`);

/** Total bytes reserved by active and pending tracks (bigint-safe: the column is a 32-bit int). */
export async function reservedBytes(db: Db | Tx): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${tracks.sizeBytes}), 0)::float8` })
    .from(tracks);
  return row?.n ?? 0;
}
