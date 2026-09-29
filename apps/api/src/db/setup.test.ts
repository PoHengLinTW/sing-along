import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../test/db';
import { labels } from './schema';
import { migrateAndSeed } from './setup';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

describe('migrateAndSeed', () => {
  it('is safe to run on every start: a second run changes nothing', async () => {
    await migrateAndSeed(t.db);
    const first = await t.db.select().from(labels);
    expect(first.length).toBeGreaterThan(0);
    await migrateAndSeed(t.db);
    expect(await t.db.select().from(labels)).toHaveLength(first.length);
  });

  it('fails loudly for a missing migrations folder', async () => {
    await expect(migrateAndSeed(t.db, '/nonexistent/drizzle')).rejects.toThrow();
  });
});
