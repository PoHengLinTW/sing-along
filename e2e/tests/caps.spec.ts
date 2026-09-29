import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { apiCreateProject, apiDeleteProject, apiUploadTrack } from '../support/api';
import { wavBuffer, wavFile } from '../support/audio';
import { createProjectViaUi, uniqueTitle, uploadTrackViaUi } from '../support/ui';

// M3-01 (caps enforced by the server), M3-02 (storage indicator), M3-03 (cap-aware UI),
// M3-10 flow 3 (the upload is refused when the project already has 10 tracks).

const storageUsage = async (request: Parameters<typeof apiCreateProject>[0]) =>
  (await (await request.get('/api/storage')).json()) as {
    usedBytes: number;
    limitBytes: number;
    projectCount: number;
    projectLimit: number;
  };

const chooser = (page: Page) => page.getByLabel(/add audio files/i);

test.describe('storage indicator', () => {
  test('the home page shows the storage used, and it follows uploads and deletes', async ({
    page,
  }) => {
    const title = uniqueTitle('Meter');
    await createProjectViaUi(page, title);
    await page.getByRole('link', { name: 'Sing-along' }).click();
    const bar = page.getByRole('progressbar', { name: 'Storage used' });
    await expect(bar).toBeVisible();
    await expect(page.getByText(/\/ 8 GB used/)).toBeVisible();
    const value = () => bar.evaluate((el: HTMLProgressElement) => el.value);
    const used = async () => (await storageUsage(page.request)).usedBytes;
    const empty = await used();
    await expect.poll(value).toBe(empty);

    // In-app navigation only (no reload): upload, go home, the figure has grown.
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await uploadTrackViaUi(page, 'Bulk', { seconds: 10 });
    await page.getByRole('link', { name: 'Sing-along' }).click();
    const withTrack = await used();
    expect(withTrack).toBeGreaterThan(empty);
    await expect.poll(value).toBe(withTrack);

    // ...and deleting the track brings it back down.
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await page.getByTestId('panel-Bulk').getByRole('button', { name: 'Delete Bulk' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.track-panel')).toHaveCount(0);
    await page.getByRole('link', { name: 'Sing-along' }).click();
    await expect.poll(value).toBe(empty);
  });

  test('the bar turns amber at 80% and red at 95%', async ({ page }) => {
    const GB = 1024 ** 3;
    const usage = (used: number) => ({
      usedBytes: Math.round(used),
      limitBytes: 8 * GB,
      projectCount: 3,
      projectLimit: 100,
      maxFileBytes: 60 * 1024 * 1024,
      maxTrackMs: 600_000,
      maxTracksPerProject: 10,
    });
    let used = 1 * GB;
    await page.route('**/api/storage', (route) => route.fulfill({ json: usage(used) }));
    await page.goto('/');
    const bar = page.getByRole('progressbar', { name: 'Storage used' });
    await expect(bar).toHaveAttribute('data-level', 'ok');
    await expect(page.getByText('1 / 8 GB used')).toBeVisible();

    used = 6.5 * GB;
    await page.reload();
    await expect(bar).toHaveAttribute('data-level', 'warn');
    await expect(page.getByText('6.5 / 8 GB used')).toBeVisible();

    used = 7.7 * GB;
    await page.reload();
    await expect(bar).toHaveAttribute('data-level', 'full');
  });
});

test.describe('file caps, on the client', () => {
  test('a file over 60 MB is refused before uploading, naming the limit; WAV gets a hint', async ({
    page,
    request,
  }, testInfo) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Big'));
    const uploads: string[] = [];
    page.on('request', (r) => r.url().includes('upload-url') && uploads.push(r.url()));
    await page.goto(`/project/${id}`);
    // Playwright refuses in-memory files over 50 MB: write them to disk.
    const hugeWav = testInfo.outputPath('huge.wav');
    const hugeMp3 = testInfo.outputPath('huge.mp3');
    writeFileSync(hugeWav, Buffer.alloc(61 * 1024 * 1024));
    writeFileSync(hugeMp3, Buffer.alloc(61 * 1024 * 1024));
    await chooser(page).setInputFiles(hugeWav);
    await expect(
      page.getByText('huge.wav: Too large (limit 60 MB). Convert to FLAC or MP3.'),
    ).toBeVisible();
    await expect(page.locator('.upload-items > li')).toHaveCount(0);

    await chooser(page).setInputFiles(hugeMp3);
    await expect(
      page.getByText('huge.mp3: Too large (limit 60 MB).', { exact: true }),
    ).toBeVisible();
    expect(uploads).toEqual([]);
  });

  test('audio longer than 10 minutes is refused before uploading', async ({ page, request }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Long'));
    const uploads: string[] = [];
    page.on('request', (r) => r.url().includes('upload-url') && uploads.push(r.url()));
    await page.goto(`/project/${id}`);
    await chooser(page).setInputFiles({
      name: 'long.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer(601, { sampleRate: 4000 }), // 4.8 MB, but 10:01 long
    });
    await page
      .locator('.upload-items > li')
      .first()
      .getByRole('button', { name: 'Upload', exact: true })
      .click();
    await expect(page.getByText('Too long (limit 10 minutes).')).toBeVisible();
    expect(uploads).toEqual([]);
    await expect(page.locator('.track-panel')).toHaveCount(0);
  });

  test('a file just under 10 minutes is accepted', async ({ page, request }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Almost'));
    await page.goto(`/project/${id}`);
    await chooser(page).setInputFiles({
      name: 'almost.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer(599, { sampleRate: 4000 }),
    });
    await page
      .locator('.upload-items > li')
      .first()
      .getByRole('button', { name: 'Upload', exact: true })
      .click();
    await expect(page.locator('.track-panel')).toHaveCount(1, { timeout: 30_000 });
  });
});

test.describe('track limit', () => {
  test('at 10 tracks the upload is disabled with a message, and the server refuses too', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Full'));
    for (let i = 1; i <= 10; i++) await apiUploadTrack(request, id, `T${i}`, 1);

    await page.goto(`/project/${id}`);
    await expect(page.locator('.track-panel')).toHaveCount(10);
    await expect(chooser(page)).toBeDisabled();
    await expect(page.getByText('Track limit reached (10).')).toBeVisible();
    await expect(page.getByText('Track limit reached (10).').first()).toBeVisible();

    // A file dropped anyway is ignored.
    await page.getByTestId('drop-zone').dispatchEvent('drop', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'late.wav', { type: 'audio/wav' }));
        return dt;
      }),
    });
    await expect(page.locator('.upload-items > li')).toHaveCount(0);

    // The server enforces it regardless of the UI.
    const res = await request.post(`/api/projects/${id}/tracks/upload-url`, {
      data: {
        name: 'x',
        mimeType: 'audio/wav',
        sizeBytes: 100,
        durationMs: 1000,
        source: 'upload',
        peaks: [0.5],
      },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'TRACK_LIMIT' });

    // Deleting one track frees a slot.
    await page.getByTestId('panel-T1').getByRole('button', { name: 'Delete T1' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.track-panel')).toHaveCount(9);
    await expect(chooser(page)).toBeEnabled();
  });

  test('recording is still allowed at the limit; uploading the draft shows the limit message and keeps the take', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('FullRec'));
    for (let i = 1; i <= 10; i++) await apiUploadTrack(request, id, `T${i}`, 1);
    await page.goto(`/project/${id}`);
    await expect(page.locator('.track-panel')).toHaveCount(10);
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();

    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /stop recording/i }).click();
    const draft = page.locator('[data-testid^="panel-draft-"]').first();
    await expect(draft).toBeVisible({ timeout: 30_000 });

    await draft.getByRole('button', { name: /upload take 1/i }).click();
    await expect(draft.getByRole('alert')).toContainText('Track limit reached (10)', {
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid^="panel-draft-"]')).toHaveCount(1); // kept
    const detail = await (await request.get(`/api/projects/${id}`)).json();
    expect(detail.tracks).toHaveLength(10); // nothing was added
  });
});

test.describe('storage budget', () => {
  test('a STORAGE_FULL rejection shows the "Storage full" message on the upload', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Budget'));
    // The 8 GB budget cannot be filled in a test, so the server's answer is simulated.
    await page.route('**/tracks/upload-url', (route) =>
      route.fulfill({
        status: 507,
        json: {
          message: 'Storage full (8 GB) — delete old tracks or projects.',
          code: 'STORAGE_FULL',
        },
      }),
    );
    await page.goto(`/project/${id}`);
    await chooser(page).setInputFiles(wavFile('any.wav', 2));
    await page
      .locator('.upload-items > li')
      .first()
      .getByRole('button', { name: 'Upload', exact: true })
      .click();
    await expect(
      page.getByText('Storage full (8 GB) — delete old tracks or projects.'),
    ).toBeVisible();
    await expect(page.locator('.track-panel')).toHaveCount(0);
  });
});

test.describe('project limit', () => {
  test('at 100 projects Create project is disabled with an explanation, and the server refuses too', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const created: number[] = [];
    try {
      const { projectCount, projectLimit } = await storageUsage(request);
      for (let i = projectCount; i < projectLimit; i++) {
        created.push((await apiCreateProject(request, uniqueTitle('Fill'))).id);
      }
      await page.goto('/');
      const create = page.getByRole('button', { name: 'Create project' });
      await expect(create).toBeDisabled();
      await expect(page.getByText(/Project limit reached \(100\)/)).toBeVisible();

      const res = await request.post('/api/projects', { data: { title: 'One too many' } });
      expect(res.status()).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'PROJECT_LIMIT' });

      // Deleting a project frees a slot.
      const victim = created.pop();
      if (victim !== undefined) await apiDeleteProject(request, victim);
      await page.reload();
      await expect(create).toBeEnabled();
    } finally {
      for (const id of created) await apiDeleteProject(request, id);
    }
  });
});
