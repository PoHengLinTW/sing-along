import { loadConfig } from '../config';
import { createDb } from './client';
import { migrateAndSeed } from './setup';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
await migrateAndSeed(db, config.migrationsDir);
await pool.end();
console.log('Migrations applied and preset labels seeded.');
