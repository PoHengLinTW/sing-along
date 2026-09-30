import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { seedLabels } from './seed';

export const SOURCE_MIGRATIONS = new URL('../../drizzle', import.meta.url).pathname;

/** Applies pending migrations and seeds the preset labels. Idempotent, so it runs on every start. */
export async function migrateAndSeed(db: NodePgDatabase, migrationsFolder = SOURCE_MIGRATIONS) {
  await migrate(db, { migrationsFolder });
  await seedLabels(db);
}
