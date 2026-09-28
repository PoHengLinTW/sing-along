import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config';
import { createDb } from './client';
import { seedLabels } from './seed';

const { db, pool } = createDb(loadConfig().databaseUrl);
await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
await seedLabels(db); // idempotent, so migrate can run on every deploy
await pool.end();
console.log('Migrations applied and preset labels seeded.');
