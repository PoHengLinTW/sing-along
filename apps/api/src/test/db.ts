import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://singalong:singalong@localhost:5433/singalong';

/** A throwaway database with all migrations applied, so DB tests never touch dev data. */
export async function createTestDb() {
  const name = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });

  return {
    db,
    pool,
    async drop() {
      await pool.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
