import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool), pool };
}
