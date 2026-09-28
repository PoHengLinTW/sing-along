import { labelCreateSchema } from '@sing-along/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app';
import { labels } from '../db/schema';
import { parseInput } from '../errors';

// Colors handed to custom labels in turn. Distinct from the preset palette's hues where possible.
const CUSTOM_COLORS = [
  '#0ea5e9',
  '#f43f5e',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#6366f1',
  '#d946ef',
  '#78716c',
];

export function registerLabelRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/api/labels', async () =>
    db.select().from(labels).orderBy(desc(labels.isPreset), asc(labels.id)),
  );

  app.post('/api/labels', async (req, reply) => {
    const { name } = parseInput(labelCreateSchema, req.body);
    const [existing] = await db
      .select()
      .from(labels)
      .where(sql`lower(${labels.name}) = lower(${name})`);
    if (existing) return reply.status(200).send(existing);

    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(labels)
      .where(eq(labels.isPreset, false));
    const color = CUSTOM_COLORS[n % CUSTOM_COLORS.length] ?? '#78716c';
    // A concurrent create of the same name loses the race at the unique index: return the winner.
    const [created] = await db
      .insert(labels)
      .values({ name, color, isPreset: false })
      .onConflictDoNothing()
      .returning();
    if (created) return reply.status(201).send(created);
    const [winner] = await db
      .select()
      .from(labels)
      .where(sql`lower(${labels.name}) = lower(${name})`);
    return reply.status(200).send(winner);
  });
}
