import { projectCreateSchema, projectUpdateSchema } from '@sing-along/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app';
import { listProjects, loadProject } from '../db/projects-repo';
import { projects, tracks } from '../db/schema';
import { notFound, parseId, parseInput } from '../errors';

export function registerProjectRoutes(app: FastifyInstance, { db, storage }: Deps) {
  app.get('/api/projects', async () => listProjects(db));

  app.post('/api/projects', async (req, reply) => {
    const input = parseInput(projectCreateSchema, req.body);
    const [row] = await db.insert(projects).values(input).returning({ id: projects.id });
    if (!row) throw new Error('insert returned no row');
    const created = await loadProject(db, row.id);
    return reply.status(201).send(created);
  });

  app.get('/api/projects/:id', async (req) => {
    const project = await loadProject(db, parseId((req.params as { id: string }).id));
    if (!project) throw notFound('Project');
    return project;
  });

  app.patch('/api/projects/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = parseInput(projectUpdateSchema, req.body);
    const [row] = await db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning({ id: projects.id });
    if (!row) throw notFound('Project');
    return loadProject(db, id);
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    // Collect keys first (pending tracks included): the rows are gone after the cascade.
    const keys = (
      await db.select({ key: tracks.storageKey }).from(tracks).where(eq(tracks.projectId, id))
    ).map((r) => r.key);
    const [row] = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning({ id: projects.id });
    if (!row) throw notFound('Project');
    try {
      await storage.deleteObjects(keys);
    } catch (err) {
      // The DB is the source of truth; leftover objects are found by the M3 orphan cleanup.
      req.log.error({ err, keys }, 'storage delete failed after project delete');
    }
    return reply.status(204).send();
  });
}
