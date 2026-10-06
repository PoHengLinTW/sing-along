import { expect, type Page, test } from '@playwright/test';
import { apiCreateProject, apiUploadTrack } from '../support/api';
import { deleteProjectsAfterEachTest } from '../support/cleanup';
import { lanes, panel, uniqueTitle, uploadTrackViaUi } from '../support/ui';

deleteProjectsAfterEachTest();

// M1-13 (track panel: mix controls, rename, reorder, delete), M1-16 (labels UI),
// M1-17 (mix persistence, per browser).

async function project(
  page: Page,
  request: Parameters<typeof apiCreateProject>[0],
  tracks: { name: string; labels?: string[] }[],
) {
  const { id } = await apiCreateProject(request, uniqueTitle('Tracks'));
  for (const t of tracks) await apiUploadTrack(request, id, t.name, 2, t.labels ?? []);
  await page.goto(`/project/${id}`);
  await expect(page.locator('.track-panel')).toHaveCount(tracks.length);
  await expect(page.locator('.lane-status')).toHaveCount(0);
  return id;
}

const volume = (page: Page, name: string) => panel(page, name).getByLabel('Volume');
const muteBtn = (page: Page, name: string) =>
  panel(page, name).getByRole('button', { name: 'Mute', exact: true });
const soloBtn = (page: Page, name: string) =>
  panel(page, name).getByRole('button', { name: 'Solo', exact: true });
const order = (page: Page) =>
  page.locator('.track-panel').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));

test.describe('mix controls', () => {
  test('volume, mute and solo follow the controls and are clearly on or off', async ({
    page,
    request,
  }) => {
    await project(page, request, [{ name: 'Alto' }, { name: 'Bass' }]);
    await expect(volume(page, 'Alto')).toHaveValue('100');
    await volume(page, 'Alto').fill('60');
    await expect(panel(page, 'Alto')).toContainText('60%');
    await volume(page, 'Bass').fill('150');
    await expect(panel(page, 'Bass')).toContainText('150%');

    await expect(muteBtn(page, 'Alto')).toHaveAttribute('aria-pressed', 'false');
    await muteBtn(page, 'Alto').click();
    await expect(muteBtn(page, 'Alto')).toHaveAttribute('aria-pressed', 'true');
    await soloBtn(page, 'Bass').click();
    await expect(soloBtn(page, 'Bass')).toHaveAttribute('aria-pressed', 'true');
    await muteBtn(page, 'Alto').click();
    await expect(muteBtn(page, 'Alto')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the mix survives a reload, and Reset mix restores the defaults', async ({
    page,
    request,
  }) => {
    await project(page, request, [{ name: 'Alto' }, { name: 'Bass' }]);
    await volume(page, 'Alto').fill('40');
    await muteBtn(page, 'Bass').click();
    await soloBtn(page, 'Alto').click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const zoomedWidth = (await lanes(page).first().boundingBox())?.width ?? 0;

    await page.reload();
    await expect(page.locator('.track-panel')).toHaveCount(2);
    await expect(volume(page, 'Alto')).toHaveValue('40');
    await expect(muteBtn(page, 'Bass')).toHaveAttribute('aria-pressed', 'true');
    await expect(soloBtn(page, 'Alto')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => (await lanes(page).first().boundingBox())?.width ?? 0)
      .toBeCloseTo(zoomedWidth, -1);

    await page.getByRole('button', { name: 'Reset mix' }).click();
    await expect(volume(page, 'Alto')).toHaveValue('100');
    await expect(muteBtn(page, 'Bass')).toHaveAttribute('aria-pressed', 'false');
    await expect(soloBtn(page, 'Alto')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the mix stays in this browser: nothing is sent to the server, another browser has its own', async ({
    page,
    request,
    browser,
  }) => {
    const id = await project(page, request, [{ name: 'Alto' }]);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET')
        writes.push(`${r.method()} ${r.url()}`);
    });
    await volume(page, 'Alto').fill('30');
    await muteBtn(page, 'Alto').click();
    await soloBtn(page, 'Alto').click();
    await page.waitForTimeout(600);
    expect(writes).toEqual([]);
    const body = JSON.stringify(await (await request.get(`/api/projects/${id}`)).json());
    expect(body).not.toMatch(/volume|muted|solo/i);

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto(`/project/${id}`);
    await expect(page2.locator('.track-panel')).toHaveCount(1);
    await expect(volume(page2, 'Alto')).toHaveValue('100');
    await expect(muteBtn(page2, 'Alto')).toHaveAttribute('aria-pressed', 'false');
    await other.close();
  });

  test('a deleted track is forgotten and a new track starts at the defaults', async ({
    page,
    request,
  }) => {
    const id = await project(page, request, [{ name: 'Alto' }, { name: 'Bass' }]);
    const detail = await (await request.get(`/api/projects/${id}`)).json();
    const bassId = String(detail.tracks.find((t: { name: string }) => t.name === 'Bass').id);
    const savedIds = async () => {
      const saved = await page.evaluate((key) => localStorage.getItem(key), `sing-along:mix:${id}`);
      return Object.keys(JSON.parse(saved ?? '{"byId":{}}').byId);
    };
    await volume(page, 'Bass').fill('20');
    await muteBtn(page, 'Bass').click();
    await expect.poll(savedIds).toContain(bassId);
    await panel(page, 'Bass').getByRole('button', { name: 'Delete Bass' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(panel(page, 'Bass')).toHaveCount(0);
    await expect.poll(savedIds).not.toContain(bassId);

    await uploadTrackViaUi(page, 'Tenor', { seconds: 2 });
    await expect(volume(page, 'Tenor')).toHaveValue('100');
    await expect(muteBtn(page, 'Tenor')).toHaveAttribute('aria-pressed', 'false');
    await expect(soloBtn(page, 'Tenor')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('track panel', () => {
  test('name and performer save on blur and persist', async ({ page, request }) => {
    await project(page, request, [{ name: 'Alto' }]);
    await panel(page, 'Alto').getByLabel('Track name').fill('Alto 2');
    await panel(page, 'Alto').getByLabel('Track name').blur();
    await expect(page.getByTestId('panel-Alto 2')).toBeVisible();
    await page.getByTestId('panel-Alto 2').getByLabel('Performer').fill('Robin');
    await page.getByTestId('panel-Alto 2').getByLabel('Performer').press('Enter');
    await page.reload();
    await expect(page.getByTestId('panel-Alto 2').getByLabel('Performer')).toHaveValue('Robin');
  });

  test('an empty track name is refused', async ({ page, request }) => {
    await project(page, request, [{ name: 'Alto' }]);
    await panel(page, 'Alto').getByLabel('Track name').fill('');
    await panel(page, 'Alto').getByLabel('Track name').blur();
    await expect(panel(page, 'Alto').getByText('Name is required')).toBeVisible();
  });

  test('move buttons reorder the tracks and the order is saved', async ({ page, request }) => {
    await project(page, request, [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }]);
    expect(await order(page)).toEqual(['panel-One', 'panel-Two', 'panel-Three']);
    await page.getByRole('button', { name: 'Move One down' }).click();
    await expect.poll(() => order(page)).toEqual(['panel-Two', 'panel-One', 'panel-Three']);
    await page.getByRole('button', { name: 'Move Three up' }).click();
    await expect.poll(() => order(page)).toEqual(['panel-Two', 'panel-Three', 'panel-One']);
    await page.reload();
    await expect(page.locator('.track-panel')).toHaveCount(3);
    expect(await order(page)).toEqual(['panel-Two', 'panel-Three', 'panel-One']);
  });

  test('dragging a panel onto another reorders them', async ({ page, request }) => {
    await project(page, request, [{ name: 'One' }, { name: 'Two' }]);
    // A panel is dropped before the one it lands on.
    await panel(page, 'Two')
      .getByRole('img', { name: /drag to reorder/i })
      .dragTo(panel(page, 'One'));
    await expect.poll(() => order(page)).toEqual(['panel-Two', 'panel-One']);
    await page.reload();
    await expect(page.locator('.track-panel')).toHaveCount(2);
    expect(await order(page)).toEqual(['panel-Two', 'panel-One']);
  });

  test('delete asks first; cancelling keeps the track, confirming removes it everywhere', async ({
    page,
    request,
  }) => {
    const id = await project(page, request, [{ name: 'Keep' }, { name: 'Goner' }]);
    await panel(page, 'Goner').getByRole('button', { name: 'Delete Goner' }).click();
    await expect(page.getByRole('dialog')).toContainText("Delete 'Goner'? This cannot be undone.");
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(panel(page, 'Goner')).toBeVisible();

    await panel(page, 'Goner').getByRole('button', { name: 'Delete Goner' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(panel(page, 'Goner')).toHaveCount(0);
    await expect(lanes(page)).toHaveCount(1);
    const detail = await (await request.get(`/api/projects/${id}`)).json();
    expect(detail.tracks.map((t: { name: string }) => t.name)).toEqual(['Keep']);
  });
});

test.describe('labels', () => {
  test('the label editor toggles presets and creates a custom label', async ({ page, request }) => {
    await project(page, request, [{ name: 'Voice' }]);
    await page.getByRole('button', { name: 'Edit labels for Voice' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Tenor', exact: true }).check();
    await dialog.getByLabel('Find or create a label').fill('Descant');
    await dialog.getByRole('button', { name: "Create 'Descant'" }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Descant', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(panel(page, 'Voice').getByText('Tenor')).toBeVisible();
    await expect(panel(page, 'Voice').getByText('Descant')).toBeVisible();

    await page.reload();
    await expect(panel(page, 'Voice').getByText('Descant')).toBeVisible();
    // and the custom label is now offered like a preset
    await page.getByRole('button', { name: 'Edit labels for Voice' }).click();
    await expect(
      page.getByRole('dialog').getByRole('checkbox', { name: 'Descant', exact: true }),
    ).toBeChecked();
  });

  test('typing filters the picker as you go', async ({ page, request }) => {
    await project(page, request, [{ name: 'Voice' }]);
    await page.getByRole('button', { name: 'Edit labels for Voice' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Find or create a label').fill('bas');
    await expect(dialog.getByRole('checkbox', { name: 'Bass', exact: true })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Alto', exact: true })).toHaveCount(0);
  });

  test('the label filter hides other tracks; "Mute all" reaches hidden tracks too', async ({
    page,
    request,
  }) => {
    await project(page, request, [
      { name: 'Ann', labels: ['Alto'] },
      { name: 'Bo', labels: ['Bass'] },
      { name: 'Cy', labels: ['Bass'] },
    ]);
    await page.getByRole('button', { name: 'Show only Alto' }).click();
    await expect(panel(page, 'Ann')).toBeVisible();
    await expect(panel(page, 'Bo')).toHaveCount(0);
    await expect(panel(page, 'Cy')).toHaveCount(0);
    await expect(lanes(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'Mute all Bass', exact: true }).click(); // Bass is hidden right now
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(panel(page, 'Bo')).toBeVisible();
    await expect(muteBtn(page, 'Bo')).toHaveAttribute('aria-pressed', 'true');
    await expect(muteBtn(page, 'Cy')).toHaveAttribute('aria-pressed', 'true');
    await expect(muteBtn(page, 'Ann')).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: 'Unmute all Bass', exact: true }).click();
    await expect(muteBtn(page, 'Bo')).toHaveAttribute('aria-pressed', 'false');
    await expect(muteBtn(page, 'Cy')).toHaveAttribute('aria-pressed', 'false');
  });

  test('reordering is disabled while a filter is active', async ({ page, request }) => {
    await project(page, request, [
      { name: 'Ann', labels: ['Alto'] },
      { name: 'Bo', labels: ['Bass'] },
    ]);
    await page.getByRole('button', { name: 'Show only Alto' }).click();
    await expect(page.getByRole('button', { name: 'Move Ann down' })).toBeDisabled();
  });
});
