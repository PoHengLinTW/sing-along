import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './db';

describe('createTestDb', () => {
  it('gives a migrated database of its own, and drops it', async () => {
    const t = await createTestDb();
    const res = await t.db.execute(sql`select count(*)::int as n from projects`);
    expect(res.rows[0]).toEqual({ n: 0 });
    await t.drop();
  });

  it('a connection that Postgres kills while the database is being dropped does not crash the run', async () => {
    const t = await createTestDb();
    await t.db.execute(sql`select 1`); // leaves an idle client in the pool
    const dropping = t.drop();
    // What the server does to a straggler connection during DROP DATABASE ... WITH (FORCE).
    expect(() =>
      t.pool.emit('error', new Error('terminating connection due to administrator command')),
    ).not.toThrow();
    await dropping;
  });

  it('but a pool error while the test is still running is not hidden', async () => {
    const t = await createTestDb();
    expect(() => t.pool.emit('error', new Error('connection lost'))).toThrow('connection lost');
    await t.drop();
  });
});
