import { expect, test } from '@playwright/test';
import { apiCreateProject, apiUploadTrack } from '../support/api';
import { deleteProjectsAfterEachTest } from '../support/cleanup';
import { currentSeconds, uniqueTitle } from '../support/ui';

deleteProjectsAfterEachTest();

// M3-05 (loading, error and empty states), M3-06 (the built server: routing and caching).

const trackIds = async (request: Parameters<typeof apiCreateProject>[0], projectId: number) => {
  const detail = await (await request.get(`/api/projects/${projectId}`)).json();
  return detail.tracks.map((t: { id: number; name: string }) => ({ id: t.id, name: t.name })) as {
    id: number;
    name: string;
  }[];
};

test.describe('load failures show a retry, never a blank page', () => {
  test('the project list', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/projects', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return ++calls === 1
        ? route.fulfill({ status: 500, json: { message: 'boom' } })
        : route.continue();
    });
    await page.goto('/');
    await expect(page.getByText("Couldn't load projects.")).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Create project' })).toBeVisible();
    await expect(page.getByText("Couldn't load projects.")).toHaveCount(0);
  });

  test('a project page', async ({ page, request }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Flaky'));
    let calls = 0;
    await page.route(`**/api/projects/${id}`, (route) =>
      ++calls === 1 ? route.abort() : route.continue(),
    );
    await page.goto(`/project/${id}`);
    await expect(page.getByText("Couldn't load this project.")).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByLabel('Title')).toBeVisible();
  });

  test('the label list in the upload form', async ({ page, request }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Labels'));
    let calls = 0;
    await page.route('**/api/labels', (route) =>
      route.request().method() === 'GET' && ++calls === 1
        ? route.fulfill({ status: 500, json: { message: 'nope' } })
        : route.continue(),
    );
    await page.goto(`/project/${id}`);
    await page.getByLabel(/add audio files/i).setInputFiles({
      name: 'a.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('x'),
    });
    await expect(page.getByText("Couldn't load labels.")).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('checkbox', { name: 'Alto', exact: true })).toBeVisible();
  });
});

test.describe('audio that fails to download', () => {
  test('that track says so and offers Retry; the rest of the project still plays', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Audio'));
    await apiUploadTrack(request, id, 'Good', 20);
    await apiUploadTrack(request, id, 'Broken', 20);
    const broken = (await trackIds(request, id)).find((t) => t.name === 'Broken');
    const pattern = new RegExp(`/tracks/${broken?.id}\\.wav`);
    await page.route(pattern, (route) => route.abort());

    await page.goto(`/project/${id}`);
    await expect(page.locator('.track-panel')).toHaveCount(2);
    const lanes = page.locator('.lane');
    await expect(lanes.nth(1)).toContainText('Failed to load audio');
    await expect(lanes.nth(0)).not.toContainText('Failed to load audio');
    await expect(lanes.nth(0).locator('.lane-status')).toHaveCount(0); // the good track is ready

    // The good track plays although the other one failed.
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => currentSeconds(page)).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Pause' }).click();

    // Retry loads only the broken one once storage works again.
    await page.unroute(pattern);
    await lanes.nth(1).getByRole('button', { name: 'Retry' }).click();
    await expect(lanes.nth(1).locator('.lane-status')).toHaveCount(0);
  });

  test('the waveform is drawn from stored peaks while the audio is still downloading', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Slow'));
    await apiUploadTrack(request, id, 'Slow one', 10);
    const [only] = await trackIds(request, id);
    const pattern = new RegExp(`/tracks/${only?.id}\\.wav`);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(pattern, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`/project/${id}`);
    const lane = page.locator('.lane').first();
    await expect(lane).toBeVisible();
    await expect(lane).toContainText('Loading audio');
    release();
    await expect(lane.locator('.lane-status')).toHaveCount(0);
  });

  test('an expired signed URL is refreshed and the download retried once, invisibly', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Expired'));
    await apiUploadTrack(request, id, 'Old link', 8);
    const [only] = await trackIds(request, id);
    const pattern = new RegExp(`/tracks/${only?.id}\\.wav`);
    let downloads = 0;
    await page.route(pattern, (route) =>
      ++downloads === 1
        ? route.fulfill({
            status: 403,
            contentType: 'application/xml',
            body: '<Error>Request has expired</Error>',
          })
        : route.continue(),
    );
    const urlRequests: string[] = [];
    page.on(
      'request',
      (r) => r.url().includes(`/api/tracks/${only?.id}/audio-url`) && urlRequests.push(r.url()),
    );

    await page.goto(`/project/${id}`);
    await expect(page.locator('.track-panel')).toHaveCount(1);
    await expect(page.locator('.lane-status')).toHaveCount(0); // loaded, no error shown
    await expect(page.getByText('Failed to load audio')).toHaveCount(0);
    expect(downloads).toBe(2);
    expect(urlRequests).toHaveLength(2); // a fresh URL was requested
  });
});

test.describe('an empty project', () => {
  test('offers Upload a track and Record; Upload opens the file chooser', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Empty'));
    await page.goto(`/project/${id}`);
    await expect(page.getByText(/no tracks yet/i)).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload a track' }).click();
    expect((await chooser).isMultiple()).toBe(true);
  });

  test('Record starts a take, and the empty message goes away once there is a draft', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('EmptyRec'));
    await page.goto(`/project/${id}`);
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Record a take' }).click();
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /stop recording/i }).click();
    await expect(page.locator('[data-testid^="panel-draft-"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByText(/no tracks yet/i)).toHaveCount(0);
  });

  test('is gone as soon as a track is uploaded', async ({ page, request }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('EmptyThenFull'));
    await page.goto(`/project/${id}`);
    await expect(page.getByText(/no tracks yet/i)).toBeVisible();
    await apiUploadTrack(request, id, 'Arrived', 2);
    await page.reload();
    await expect(page.getByTestId('panel-Arrived')).toBeVisible();
    await expect(page.getByText(/no tracks yet/i)).toHaveCount(0);
  });
});

test.describe('the built server', () => {
  test('a deep link opens the app, an unknown API path is a JSON 404, health is ok', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Deep'));
    await page.goto(`/project/${id}`); // a cold load of a client-side route
    await expect(page.getByLabel('Title')).toBeVisible();

    const missing = await request.get('/api/does-not-exist');
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ message: 'Not found' });

    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
  });

  test('hashed assets are cached for a year; the page itself is always revalidated', async ({
    request,
  }) => {
    const index = await request.get('/');
    expect(index.headers()['cache-control']).toBe('no-cache');
    const html = await index.text();
    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
    expect(asset).toBeTruthy();
    const script = await request.get(asset ?? '');
    expect(script.status()).toBe(200);
    expect(script.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request.get('/assets/missing-abcdefgh.js')).status()).toBe(404);
  });
});
