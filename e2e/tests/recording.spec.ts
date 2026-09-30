import { expect, type Page, test } from '@playwright/test';
import { apiCreateProject, apiUploadTrack } from '../support/api';
import { currentSeconds, uniqueTitle } from '../support/ui';

// M2 (recording): mic setup and errors, input check, record over a track, draft, latency offset,
// upload, discard, crash recovery, leave guard. Chromium's fake microphone stands in for a real
// one (see playwright.config.ts); how it sounds on real hardware stays a manual check.

async function openWithBacking(
  page: Page,
  request: Parameters<typeof apiCreateProject>[0],
  seconds = 10,
) {
  const { id } = await apiCreateProject(request, uniqueTitle('Record'));
  await apiUploadTrack(request, id, 'Backing', seconds);
  await page.goto(`/project/${id}`);
  await expect(page.getByTestId('panel-Backing')).toBeVisible();
  await expect(page.locator('.lane-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
  return id;
}

const record = (page: Page) => page.getByRole('button', { name: 'Record', exact: true });
const stop = (page: Page) => page.getByRole('button', { name: /stop recording/i });
const drafts = (page: Page) => page.locator('[data-testid^="panel-draft-"]');

/** Records for about `ms` with the buttons, and waits until the take is encoded into a draft. */
async function takeOf(page: Page, ms = 2500) {
  const before = await drafts(page).count();
  await record(page).click();
  await expect(stop(page)).toBeVisible();
  await page.waitForTimeout(ms);
  await stop(page).click();
  await expect(drafts(page)).toHaveCount(before + 1, { timeout: 30_000 });
}

test('record over a track, stop, align it by ear, upload it: it becomes a recording track', async ({
  page,
  request,
}) => {
  const id = await openWithBacking(page, request);

  // Input check first: the meter moves, M mutes the check.
  await page.getByRole('button', { name: /check input level/i }).click();
  await expect
    .poll(() => page.locator('meter').evaluate((m: HTMLMeterElement) => m.value), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0.01);
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Mic muted' })).toBeVisible();
  await page.keyboard.press('m');
  await page.getByRole('button', { name: /stop checking/i }).click();

  // R starts a take at the playhead while the backing track plays.
  await page.keyboard.press('r');
  await expect(stop(page)).toBeVisible({ timeout: 15_000 });
  await expect(stop(page)).toHaveClass(/recording/);
  await page.waitForTimeout(3000);
  await expect(stop(page)).toContainText(/0:0[2-5]/); // elapsed time
  await expect(page.getByTestId('lane-recording')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas.recording-canvas');
        if (!c) return 0;
        const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? [];
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 0) n++;
        return n;
      }),
    )
    .toBeGreaterThan(50); // the live waveform is being drawn
  expect(await currentSeconds(page)).toBeGreaterThan(2); // the playhead moved with the take

  // Seeking and looping are locked while recording.
  await expect(page.getByRole('button', { name: 'Restart' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Set loop start (A)' })).toBeDisabled();

  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Mic muted' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press('m');
  await page.keyboard.press('r');

  // The draft shows up below the tracks, clearly marked, with a default name.
  const draft = drafts(page).first();
  await expect(draft).toBeVisible({ timeout: 30_000 });
  await expect(draft).toContainText('Draft');
  await expect(draft.getByLabel('Take name')).toHaveValue('Take 1');
  await expect(page.locator('[data-testid^="lane-draft-"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Restart' })).toBeEnabled(); // unlocked again

  // Align by ear, then upload.
  await draft.getByLabel('Latency offset (ms)').fill('-50');
  await draft.getByLabel('Performer').fill('Ann');
  await draft.getByLabel('Performer').press('Enter');
  await page.waitForTimeout(800);
  await draft.getByRole('button', { name: /upload take 1/i }).click();
  await expect(drafts(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.track-panel')).toHaveCount(2);

  const detail = await (await request.get(`/api/projects/${id}`)).json();
  const take = detail.tracks.find((t: { source: string }) => t.source === 'recording');
  expect(take).toMatchObject({ mimeType: 'audio/flac', latencyOffsetMs: -50, performer: 'Ann' });
  expect(take.durationMs).toBeGreaterThan(3000);
  expect(take.peaks.length).toBeGreaterThan(100);

  // It is a normal track now: it survives a reload and no draft is left behind.
  await page.reload();
  await expect(page.locator('.track-panel')).toHaveCount(2);
  await expect(drafts(page)).toHaveCount(0);
});

test.describe('mic setup', () => {
  test('the headphone hint shows once and "Don\'t show again" is remembered', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 4);
    await expect(page.getByText('Use headphones')).toBeVisible();
    await page.getByRole('button', { name: "Don't show again" }).click();
    await expect(page.getByText('Use headphones')).toHaveCount(0);
    await page.reload();
    await expect(record(page)).toBeVisible();
    await expect(page.getByText('Use headphones')).toHaveCount(0);
  });

  test('the input picker lists the microphones, saves the choice, and falls back to the default when that device is gone', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 4);
    const picker = page.getByRole('combobox', { name: 'Input' });
    await expect(picker.locator('option')).not.toHaveCount(1);
    const second = (await picker.locator('option').nth(2).getAttribute('value')) ?? '';
    await picker.selectOption(second);
    expect(await page.evaluate(() => localStorage.getItem('sing-along:mic-device'))).toBe(second);

    // Chromium's fake microphones get new ids on every page load, so after a reload the saved
    // device no longer exists: the picker must fall back to the default and recording still works.
    await page.reload();
    await expect(record(page)).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Input' })).toHaveValue('');
    await takeOf(page, 1500);
    await expect(drafts(page)).toHaveCount(1);
  });

  test('a blocked microphone gets a message that says how to allow it', async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    });
    await openWithBacking(page, request, 4);
    await record(page).click();
    await expect(page.getByText(/microphone access is blocked/i)).toBeVisible();
    await expect(page.getByText(/allow the microphone for this site/i)).toBeVisible();
    await expect(record(page)).toBeEnabled(); // nothing is stuck
  });

  test('no microphone at all gets a clear message', async ({ page, request }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' }));
    });
    await openWithBacking(page, request, 4);
    await record(page).click();
    await expect(page.getByText(/no microphone found/i)).toBeVisible();
  });
});

test.describe('drafts', () => {
  test('several takes can exist at once, named Take 1, Take 2, and can be renamed', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 8);
    await takeOf(page, 1500);
    await takeOf(page, 1500);
    await expect(drafts(page)).toHaveCount(2);
    await expect(page.getByLabel('Take name').nth(0)).toHaveValue('Take 1');
    await expect(page.getByLabel('Take name').nth(1)).toHaveValue('Take 2');
    await page.getByLabel('Take name').nth(1).fill('Harmony try');
    await page.getByLabel('Take name').nth(1).blur();
    await expect(page.getByLabel('Take name').nth(1)).toHaveValue('Harmony try');
  });

  test('a draft has volume, mute and solo like a track, and a loop-around-here preview', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 8);
    await takeOf(page, 1500);
    const draft = drafts(page).first();
    await draft.getByLabel('Volume').fill('70');
    await expect(draft).toContainText('70%');
    await draft.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(draft.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(draft.getByRole('button', { name: 'Loop around here' })).toBeVisible();
    await draft.getByLabel('Latency offset (ms)').fill('40');
    await draft.getByRole('button', { name: 'Reset latency offset' }).click();
    await expect(draft.getByLabel('Latency offset (ms)')).toHaveValue('0');
  });

  test('the latency offset can be typed, nudged with the arrow keys, and shifts the lane', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 8);
    await takeOf(page, 1500);
    const draft = drafts(page).first();
    const lane = page.locator('[data-testid^="lane-draft-"]').first();
    const left = async () => (await lane.boundingBox())?.x ?? 0;
    const start = await left();
    await draft.getByLabel('Latency offset (ms)').fill('200');
    await expect.poll(left).toBeGreaterThan(start + 5); // +200 ms is ~10 px at 50 px/s
    const slider = draft.getByLabel('Latency offset', { exact: true });
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(draft.getByLabel('Latency offset (ms)')).toHaveValue('201');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(draft.getByLabel('Latency offset (ms)')).toHaveValue('191');
  });

  test('discard asks first: cancel keeps the take, confirm removes it for good', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 6);
    await takeOf(page, 1500);
    await drafts(page)
      .first()
      .getByRole('button', { name: /discard take 1/i })
      .click();
    await expect(page.getByRole('dialog')).toContainText('exists only on this device');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(drafts(page)).toHaveCount(1);

    await drafts(page)
      .first()
      .getByRole('button', { name: /discard take 1/i })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(drafts(page)).toHaveCount(0);
    await page.reload();
    await expect(record(page)).toBeVisible();
    await expect(drafts(page)).toHaveCount(0);
  });

  test('a draft survives a reload, and an upload that fails keeps it with a Retry', async ({
    page,
    request,
  }) => {
    const id = await openWithBacking(page, request, 6);
    await takeOf(page, 1500);
    await page.reload();
    await expect(drafts(page)).toHaveCount(1); // drafts live in this browser until uploaded

    await page.route(/\/sing-along-e2e\/.*\.flac/, (route) =>
      route.request().method() === 'PUT' ? route.abort() : route.continue(),
    );
    await drafts(page)
      .first()
      .getByRole('button', { name: /upload take 1/i })
      .click();
    const alert = drafts(page).first().getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(drafts(page)).toHaveCount(1);
    await page.unroute(/\/sing-along-e2e\/.*\.flac/);
    await drafts(page).first().getByRole('button', { name: /retry/i }).click();
    await expect(drafts(page)).toHaveCount(0, { timeout: 30_000 });
    const detail = await (await request.get(`/api/projects/${id}`)).json();
    expect(detail.tracks.filter((t: { source: string }) => t.source === 'recording')).toHaveLength(
      1,
    );
  });

  test('drafts belong to their own project only', async ({ page, request }) => {
    await openWithBacking(page, request, 6);
    await takeOf(page, 1500);
    const other = await apiCreateProject(request, uniqueTitle('Other'));
    await page.goto(`/project/${other.id}`);
    await expect(page.getByLabel('Title')).toBeVisible();
    await expect(drafts(page)).toHaveCount(0);
  });
});

test.describe('safety', () => {
  test('closing the tab during a take asks "Leave site?"; not while idle', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 6);
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.type());
      await d.dismiss();
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    );
    expect(dialogs).toEqual([]);

    await record(page).click();
    await expect(stop(page)).toBeVisible();
    const prevented = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await page.waitForTimeout(1500);
    await stop(page).click();
    await expect(drafts(page)).toHaveCount(1, { timeout: 30_000 });
  });

  test('a take cut short by a crash comes back as a draft', async ({ page, request, context }) => {
    const id = await openWithBacking(page, request, 10);
    await page.keyboard.press('r');
    await expect(stop(page)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(4500);
    await page.close({ runBeforeUnload: false }); // as if the tab crashed mid-take

    const again = await context.newPage();
    await again.goto(`/project/${id}`);
    await expect(drafts(again)).toHaveCount(1, { timeout: 30_000 });
    const lane = again.locator('[data-testid^="lane-draft-"]').first();
    const width = Number.parseFloat(await lane.evaluate((el) => (el as HTMLElement).style.width));
    expect(width).toBeGreaterThan(100); // at least ~2 s of the take was kept
  });
});
