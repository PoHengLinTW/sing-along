import { test } from '@playwright/test';

/**
 * Deletes every project (and with it its tracks and stored files) after each test.
 *
 * All tests share one database and bucket, and the server allows 100 projects. Without this the
 * suite quietly approaches that cap, and whichever test happens to run last fails to create its
 * project. It also keeps tests independent of each other and the bucket small.
 */
export function deleteProjectsAfterEachTest() {
  test.afterEach(async ({ request }) => {
    const res = await request.get('/api/projects');
    if (!res.ok()) return;
    const projects = (await res.json()) as { id: number }[];
    for (const p of projects) await request.delete(`/api/projects/${p.id}`);
  });
}
