import { expect, type Page, test } from '@playwright/test';
import { apiCreateProject, apiUploadTrack } from '../support/api';
import { currentSeconds, uniqueTitle } from '../support/ui';

// M2 (recording): mic setup and errors, input check, record over a track, draft, start time,
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
  for (let i = 0; i < 5; i++)
    await draft.getByRole('button', { name: 'Start 10 ms earlier' }).click();
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
    const original = await draft.getByRole('textbox', { name: 'Start time' }).inputValue();
    await draft.getByRole('button', { name: 'Start 100 ms later' }).click();
    await expect(draft.getByRole('textbox', { name: 'Start time' })).not.toHaveValue(original);
    await draft.getByRole('button', { name: 'Reset start time' }).click();
    await expect(draft.getByRole('textbox', { name: 'Start time' })).toHaveValue(original);
  });

  test('the start time can be typed, nudged with buttons and arrow keys, and shifts the lane', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 8);
    await takeOf(page, 1500);
    const draft = drafts(page).first();
    const lane = page.locator('[data-testid^="lane-draft-"]').first();
    const left = async () => (await lane.boundingBox())?.x ?? 0;
    const field = draft.getByRole('textbox', { name: 'Start time' });
    const start = await left();
    await field.fill('00:05.000');
    await field.press('Enter');
    await expect(field).toHaveValue('00:05.000');
    await expect.poll(left).toBeGreaterThan(start + 200); // 5 s is ~250 px at 50 px/s
    await field.press('ArrowUp');
    await expect(field).toHaveValue('00:05.010');
    await field.press('Shift+ArrowDown');
    await expect(field).toHaveValue('00:04.910');
    await draft.getByRole('button', { name: 'Start 100 ms earlier' }).click();
    await expect(field).toHaveValue('00:04.810');
  });

  test('an unreadable start time is flagged and put back', async ({ page, request }) => {
    await openWithBacking(page, request, 8);
    await takeOf(page, 1500);
    const field = drafts(page).first().getByRole('textbox', { name: 'Start time' });
    const original = await field.inputValue();
    await field.fill('soon');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await field.press('Enter');
    await expect(field).toHaveValue(original);
    await expect(field).toHaveAttribute('aria-invalid', 'false');
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

test.describe('recording sheet', () => {
  const sheet = (page: Page) => page.getByRole('region', { name: 'Recording' });
  const finish = (page: Page) => page.getByRole('button', { name: 'Finish recording' });
  const clock = (page: Page, label: 'Song' | 'Recorded') =>
    sheet(page)
      .locator('div', { has: page.getByText(label, { exact: true }) })
      .locator('dd')
      .first();
  const startTake = async (page: Page) => {
    await record(page).click();
    await expect(sheet(page)).toBeVisible({ timeout: 15_000 });
    await expect(sheet(page).getByRole('status')).toHaveText('Recording', { timeout: 15_000 });
  };

  test('opens when a take starts, draws the live waveform, and closes when the take is finished', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request);
    await expect(sheet(page)).toHaveCount(0);
    await startTake(page);
    await expect(sheet(page).getByRole('img', { name: 'Live microphone waveform' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>('canvas.sheet-wave');
          const d = c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? [];
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 0) n++;
          return n;
        }),
      )
      .toBeGreaterThan(20);
    await expect(sheet(page).getByLabel('Input level')).toBeVisible();
    // Song position and recorded time are two separate, advancing values.
    await expect(clock(page, 'Song')).not.toHaveText('00:00.000');
    await expect(clock(page, 'Recorded')).not.toHaveText('00:00.000');
    // The sheet owns the take: Escape does not end it.
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await finish(page).click();
    await expect(sheet(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(drafts(page)).toHaveCount(1, { timeout: 30_000 });
  });

  test('Pause freezes the song and the recorded time; Resume continues the same take', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 12);
    await startTake(page);
    await page.waitForTimeout(1500);
    await sheet(page).getByRole('button', { name: 'Pause recording' }).click();
    await expect(sheet(page).getByRole('status')).toHaveText('Paused');
    await expect(sheet(page).getByRole('button', { name: 'Resume recording' })).toBeVisible();
    const song = await clock(page, 'Song').textContent();
    const recorded = await clock(page, 'Recorded').textContent();
    await page.waitForTimeout(2500);
    expect(await clock(page, 'Song').textContent()).toBe(song);
    expect(await clock(page, 'Recorded').textContent()).toBe(recorded);

    await sheet(page).getByRole('button', { name: 'Resume recording' }).click();
    await expect(sheet(page).getByRole('status')).toHaveText('Recording');
    await expect(clock(page, 'Recorded')).not.toHaveText(recorded as string);
    await page.waitForTimeout(1500);
    await finish(page).click();
    await expect(drafts(page)).toHaveCount(1, { timeout: 30_000 });

    // One take of about 3 s: the 2.5 s pause added no silence.
    const draft = drafts(page).first();
    await draft.getByRole('button', { name: /upload take 1/i }).click();
    await expect(drafts(page)).toHaveCount(0, { timeout: 30_000 });
    const detail = await (await request.get(`/api/projects/${await projectIdOf(page)}`)).json();
    const take = detail.tracks.find((t: { source: string }) => t.source === 'recording');
    expect(take.durationMs).toBeGreaterThan(2200);
    expect(take.durationMs).toBeLessThan(4300);
  });

  test('P pauses and resumes from the keyboard', async ({ page, request }) => {
    await openWithBacking(page, request, 12);
    await startTake(page);
    await page.keyboard.press('p');
    await expect(sheet(page).getByRole('status')).toHaveText('Paused');
    await page.keyboard.press('p');
    await expect(sheet(page).getByRole('status')).toHaveText('Recording');
    await page.waitForTimeout(1500); // a take of about 1 s or less leaves no draft
    await finish(page).click();
    await expect(drafts(page)).toHaveCount(1, { timeout: 30_000 });
  });

  test('Mute microphone says the take records silence; Unmute undoes it; it can change while paused', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 12);
    await startTake(page);
    const mute = sheet(page).getByRole('button', { name: 'Mute microphone' });
    await mute.click();
    await expect(sheet(page).getByRole('status')).toContainText(/muted.*silence/i);
    await sheet(page).getByRole('button', { name: 'Pause recording' }).click();
    await expect(sheet(page).getByRole('status')).toHaveText('Paused, microphone muted');
    await sheet(page).getByRole('button', { name: 'Unmute microphone' }).click();
    await expect(sheet(page).getByRole('status')).toHaveText('Paused');
    await sheet(page).getByRole('button', { name: 'Resume recording' }).click();
    await expect(sheet(page).getByRole('status')).toHaveText('Recording');
    await finish(page).click();
    await expect(drafts(page)).toHaveCount(1, { timeout: 30_000 });
  });

  test('Finish while paused saves the take once, even on a double click', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 12);
    await startTake(page);
    await page.waitForTimeout(1500);
    await sheet(page).getByRole('button', { name: 'Pause recording' }).click();
    await finish(page).dblclick();
    await expect(sheet(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(drafts(page)).toHaveCount(1, { timeout: 30_000 });
    await page.waitForTimeout(1000);
    await expect(drafts(page)).toHaveCount(1);
  });

  test('the transport Stop button also finishes a paused take', async ({ page, request }) => {
    await openWithBacking(page, request, 12);
    await startTake(page);
    await page.waitForTimeout(1200);
    await page.keyboard.press('p');
    await expect(sheet(page).getByRole('status')).toHaveText('Paused');
    await stop(page).click();
    await expect(drafts(page)).toHaveCount(1, { timeout: 30_000 });
  });
});

test.describe('start time of an uploaded track', () => {
  test('is typed in, saved to the project, and still there after a reload', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Start'));
    await apiUploadTrack(request, id, 'Alto', 6);
    await page.goto(`/project/${id}`);
    const panel = page.getByTestId('panel-Alto');
    const field = panel.getByRole('textbox', { name: 'Start time' });
    await expect(field).toHaveValue('00:00.000');
    await field.fill('00:03.500');
    await field.press('Enter');
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${id}`)).json()).tracks[0].latencyOffsetMs,
      )
      .toBe(3500);
    await page.reload();
    await expect(
      page.getByTestId('panel-Alto').getByRole('textbox', { name: 'Start time' }),
    ).toHaveValue('00:03.500');
    await expect(page.getByTestId('panel-Alto').getByText(/latency|delay/i)).toHaveCount(0);
  });
});

test.describe('dragging a lane to set its start time', () => {
  /** Drags the lane's grip by `dx` px with the mouse, in small steps. */
  async function dragGrip(page: Page, testId: string, dx: number) {
    await page.getByTestId(testId).scrollIntoViewIfNeeded();
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) throw new Error('grip not visible');
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
    await page.mouse.up();
  }

  test('dragging an uploaded track moves it, updates the Start time field and saves it', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Drag'));
    await apiUploadTrack(request, id, 'Alto', 6);
    await page.goto(`/project/${id}`);
    const field = page.getByTestId('panel-Alto').getByRole('textbox', { name: 'Start time' });
    const grip = page.getByTestId('grip-track:' + (await firstTrackId(request, id)));
    await expect(grip).toContainText('00:00.000');
    const lane = page.getByTestId(/^lane-\d+$/).first();
    const before = (await lane.boundingBox())?.x ?? 0;

    await dragGrip(page, 'grip-track:' + (await firstTrackId(request, id)), 100); // 100 px = 2 s at 50 px/s
    await expect(field).not.toHaveValue('00:00.000');
    await expect(grip).toContainText(/00:0[12]\./);
    expect(((await lane.boundingBox())?.x ?? 0) - before).toBeGreaterThan(80);
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${id}`)).json()).tracks[0].latencyOffsetMs,
        {
          timeout: 5000,
        },
      )
      .toBeGreaterThan(1500);
    await page.reload();
    await expect(
      page.getByTestId('panel-Alto').getByRole('textbox', { name: 'Start time' }),
    ).not.toHaveValue('00:00.000');
  });

  test('a drag cannot pull the track before zero, and does not move the playhead', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('DragLeft'));
    await apiUploadTrack(request, id, 'Alto', 6);
    await page.goto(`/project/${id}`);
    const trackId = await firstTrackId(request, id);
    const seconds = await currentSeconds(page);
    await dragGrip(page, `grip-track:${trackId}`, -80);
    await expect(
      page.getByTestId('panel-Alto').getByRole('textbox', { name: 'Start time' }),
    ).toHaveValue('00:00.000');
    expect(await currentSeconds(page)).toBe(seconds);
  });

  test('a draft can be dragged too, and clicking the lane elsewhere still seeks', async ({
    page,
    request,
  }) => {
    await openWithBacking(page, request, 8);
    await takeOf(page, 1500);
    const draftId = (await drafts(page).first().getAttribute('data-testid'))?.replace(
      'panel-draft-',
      '',
    );
    await dragGrip(page, `grip-draft:${draftId}`, 100);
    await expect(drafts(page).first().getByRole('textbox', { name: 'Start time' })).not.toHaveValue(
      '00:00.000',
    );
    const lane = page.getByTestId('lane-Backing').or(page.getByTestId(/^lane-\d+$/).first());
    const box = await lane.boundingBox();
    if (!box) throw new Error('no lane');
    await page.mouse.click(box.x + 200, box.y + box.height - 20);
    expect(await currentSeconds(page)).toBeGreaterThan(2);
  });
});

async function firstTrackId(request: Parameters<typeof apiCreateProject>[0], projectId: number) {
  return (await (await request.get(`/api/projects/${projectId}`)).json()).tracks[0].id as number;
}

/** The project id from the page address. */
async function projectIdOf(page: Page): Promise<number> {
  return Number(new URL(page.url()).pathname.split('/').pop());
}
