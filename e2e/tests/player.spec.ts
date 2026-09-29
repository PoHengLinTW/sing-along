import { expect, type Page, test } from '@playwright/test';
import { apiCreateProject, apiUploadTrack } from '../support/api';
import { currentSeconds, lanes, pxPerSecond, timeText, uniqueTitle } from '../support/ui';

// M1-10 (transport), M1-12 (seek, zoom, ruler), M1-14 (transport bar, shortcuts), M1-15 (A-B loop).

/** A project holding one track of `seconds`, opened and with its audio loaded. */
async function openProject(
  page: Page,
  request: Parameters<typeof apiCreateProject>[0],
  seconds: number,
) {
  const { id } = await apiCreateProject(request, uniqueTitle('Player'));
  await apiUploadTrack(request, id, 'Tone', seconds);
  await page.goto(`/project/${id}`);
  await expect(page.getByTestId('panel-Tone')).toBeVisible();
  await expect(page.locator('.lane-status')).toHaveCount(0);
  return id;
}

const play = (page: Page) => page.getByRole('button', { name: 'Play' }).click();
const pause = (page: Page) => page.getByRole('button', { name: 'Pause' }).click();

/** Click at a time position on the ruler (which seeks). */
async function clickRulerAt(page: Page, seconds: number, pxPerSec: number) {
  const box = await page.getByTestId('ruler').boundingBox();
  if (!box) throw new Error('no ruler');
  await page.mouse.click(box.x + seconds * pxPerSec, box.y + box.height / 2);
}

test.describe('transport', () => {
  test('play advances the time, pause holds it', async ({ page, request }) => {
    await openProject(page, request, 30);
    await expect(timeText(page)).toHaveText(/^00:00\.0 \/ 00:30$/);
    await play(page);
    await expect.poll(() => currentSeconds(page)).toBeGreaterThan(1);
    await pause(page);
    const held = await currentSeconds(page);
    await page.waitForTimeout(700);
    expect(await currentSeconds(page)).toBe(held);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('restart goes to 0 and keeps playing if it was playing', async ({ page, request }) => {
    await openProject(page, request, 30);
    await play(page);
    await expect.poll(() => currentSeconds(page)).toBeGreaterThan(2);
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect.poll(() => currentSeconds(page)).toBeLessThan(1.5);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect.poll(() => currentSeconds(page)).toBeGreaterThan(0.3); // still moving
  });

  test('±10 s buttons: back stops at 0, forward stops at the end', async ({ page, request }) => {
    await openProject(page, request, 25);
    const forward = page.getByRole('button', { name: 'Forward 10 seconds' });
    const back = page.getByRole('button', { name: 'Back 10 seconds' });
    await forward.click();
    expect(await currentSeconds(page)).toBeCloseTo(10, 0);
    await back.click();
    expect(await currentSeconds(page)).toBeCloseTo(0, 0);
    await back.click();
    expect(await currentSeconds(page)).toBe(0);
    await forward.click();
    await forward.click();
    await forward.click();
    expect(await currentSeconds(page)).toBeCloseTo(25, 0);
  });

  test('reaching the end stops playback', async ({ page, request }) => {
    await openProject(page, request, 3);
    await play(page);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 10_000 });
    expect(await currentSeconds(page)).toBeCloseTo(3, 0);
  });

  test('buttons carry their shortcut in the tooltip', async ({ page, request }) => {
    await openProject(page, request, 5);
    await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute('title', /Space/);
    await expect(page.getByRole('button', { name: 'Restart' })).toHaveAttribute('title', /Home/);
  });
});

test.describe('keyboard shortcuts', () => {
  test('Space plays and pauses, Home restarts, arrows jump 10 s', async ({ page, request }) => {
    await openProject(page, request, 40);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    expect(await currentSeconds(page)).toBeGreaterThanOrEqual(10);
    await page.keyboard.press('ArrowLeft');
    expect(await currentSeconds(page)).toBeLessThan(1);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Home');
    expect(await currentSeconds(page)).toBe(0);
  });

  test('shortcuts are ignored while typing in a field', async ({ page, request }) => {
    await openProject(page, request, 40);
    const title = page.getByLabel('Title');
    await title.click();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Home');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(await currentSeconds(page)).toBe(0);
    await expect(title).toHaveValue(/Player .* /); // the space was typed into the field
  });
});

test.describe('timeline', () => {
  test('clicking the waveform seeks, also while playing', async ({ page, request }) => {
    await openProject(page, request, 30);
    const pps = await pxPerSecond(page, 0, 30);
    const clickLaneAt = async (seconds: number) => {
      // Measured at click time: the view scrolls to follow the playhead while playing.
      const box = await lanes(page).first().boundingBox();
      if (!box) throw new Error('no lane');
      await page.mouse.click(box.x + seconds * pps, box.y + box.height / 2);
    };
    await clickLaneAt(9);
    expect(await currentSeconds(page)).toBeCloseTo(9, 0);
    await play(page);
    await clickLaneAt(3);
    await expect.poll(() => currentSeconds(page), { timeout: 3000 }).toBeLessThan(6);
    expect(await currentSeconds(page)).toBeGreaterThan(2.5);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible(); // still playing
  });

  test('clicking the ruler seeks', async ({ page, request }) => {
    await openProject(page, request, 30);
    const pps = await pxPerSecond(page, 0, 30);
    await clickRulerAt(page, 12, pps); // the visible part of the ruler; longer tracks scroll
    expect(await currentSeconds(page)).toBeCloseTo(12, 0);
  });

  test('zoom in widens the waveform and zoom out narrows it', async ({ page, request }) => {
    await openProject(page, request, 30);
    const width = async () => (await lanes(page).first().boundingBox())?.width ?? 0;
    const base = await width();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(width).toBeGreaterThan(base * 1.1);
    const zoomed = await width();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(width).toBeLessThan(zoomed * 0.9);
  });
});

test.describe('A-B loop', () => {
  test('Set A and Set B mark a region at the playhead; Clear removes it', async ({
    page,
    request,
  }) => {
    await openProject(page, request, 30);
    const pps = await pxPerSecond(page, 0, 30);
    await clickRulerAt(page, 5, pps);
    await page.getByRole('button', { name: 'Set loop start (A)' }).click();
    await clickRulerAt(page, 9, pps);
    await page.getByRole('button', { name: 'Set loop end (B)' }).click();
    await expect(page.getByTestId('loop-region')).toBeVisible();
    await expect(page.getByTestId('loop-range')).toHaveText('A 0:05 – B 0:09');
    await page.getByRole('button', { name: 'Clear loop' }).click();
    await expect(page.getByTestId('loop-region')).toHaveCount(0);
  });

  test('dragging on the ruler creates a region whose edges can be adjusted', async ({
    page,
    request,
  }) => {
    await openProject(page, request, 30);
    const pps = await pxPerSecond(page, 0, 30);
    const ruler = await page.getByTestId('ruler').boundingBox();
    if (!ruler) throw new Error('no ruler');
    const y = ruler.y + ruler.height / 2;
    await page.mouse.move(ruler.x + 4 * pps, y);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 8 * pps, y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('loop-region')).toBeVisible();
    await expect(page.getByTestId('loop-range')).toHaveText('A 0:04 – B 0:08');

    const handle = await page.getByTestId('loop-handle-b').boundingBox();
    if (!handle) throw new Error('no handle');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 12 * pps, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('loop-range')).toHaveText('A 0:04 – B 0:12');
  });

  test('with looping on, playback wraps from B back to A instead of running on', async ({
    page,
    request,
  }) => {
    await openProject(page, request, 30);
    const pps = await pxPerSecond(page, 0, 30);
    await clickRulerAt(page, 2, pps);
    await page.getByRole('button', { name: 'Set loop start (A)' }).click();
    await clickRulerAt(page, 5, pps);
    await page.getByRole('button', { name: 'Set loop end (B)' }).click();
    // Defining a region turns looping on.
    await expect(page.getByRole('button', { name: 'Loop', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await clickRulerAt(page, 4, pps);

    await play(page);
    const seen: number[] = [];
    for (let i = 0; i < 16; i++) {
      seen.push(await currentSeconds(page));
      await page.waitForTimeout(250);
    }
    await pause(page);
    expect(Math.max(...seen)).toBeLessThan(5.6); // never ran past B
    expect(seen.some((s, i) => i > 0 && s < (seen[i - 1] ?? 0) - 0.5)).toBe(true); // it wrapped
    expect(Math.min(...seen.slice(3))).toBeGreaterThanOrEqual(1.9); // and stayed within A..B
  });

  test('switching the loop off lets playback run past B; a region can be set again after Clear', async ({
    page,
    request,
  }) => {
    await openProject(page, request, 30);
    const pps = await pxPerSecond(page, 0, 30);
    await clickRulerAt(page, 1, pps);
    await page.getByRole('button', { name: 'Set loop start (A)' }).click();
    await clickRulerAt(page, 3, pps);
    await page.getByRole('button', { name: 'Set loop end (B)' }).click();
    const toggle = page.getByRole('button', { name: 'Loop', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await clickRulerAt(page, 2, pps);
    await play(page);
    await expect.poll(() => currentSeconds(page), { timeout: 6000 }).toBeGreaterThan(3.5);
    await pause(page);
    await page.getByRole('button', { name: 'Clear loop' }).click();
    await expect(page.getByTestId('loop-region')).toHaveCount(0);
  });
});
