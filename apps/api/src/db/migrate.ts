import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config';
import { createDb } from './client';

const { db, pool } = createDb(loadConfig().databaseUrl);
await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
await pool.end();
console.log('Migrations applied.');
