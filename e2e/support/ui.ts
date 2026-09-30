import { expect, type Locator, type Page } from '@playwright/test';
import { wavFile } from './audio';

let counter = 0;
/** A title no other test uses, so tests can share one database. */
export const uniqueTitle = (prefix = 'E2E') => `${prefix} ${Date.now().toString(36)}-${++counter}`;

/** Home -> Create project dialog -> the new project's page. */
export async function createProjectViaUi(page: Page, title = uniqueTitle()) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/\/project\/\d+/);
  await expect(page.getByLabel('Title')).toHaveValue(title);
  return { title, id: Number(page.url().match(/project\/(\d+)/)?.[1]) };
}

/** Picks a generated WAV, fills the form and uploads it; resolves once the track has its lane. */
export async function uploadTrackViaUi(
  page: Page,
  name: string,
  opts: { seconds?: number; performer?: string; labels?: string[]; freq?: number } = {},
) {
  const before = await page.locator('.track-panel').count();
  await page
    .getByLabel(/add audio files/i)
    .setInputFiles(wavFile(`${name}.wav`, opts.seconds ?? 3, { freq: opts.freq }));
  const item = page.locator('.upload-items > li').last();
  await item.getByLabel('Name', { exact: true }).fill(name);
  if (opts.performer) await item.getByLabel('Performer').fill(opts.performer);
  for (const label of opts.labels ?? []) {
    await item.getByRole('checkbox', { name: label, exact: true }).check();
  }
  await item.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.locator('.track-panel')).toHaveCount(before + 1);
  await expect(page.locator('.lane-status')).toHaveCount(0); // audio downloaded and decoded
}

export const timeText = (page: Page) => page.getByTestId('time');
export const panel = (page: Page, name: string) => page.getByTestId(`panel-${name}`);

/** Parses the transport's "mm:ss.s / mm:ss" into the current position in seconds. */
export async function currentSeconds(page: Page): Promise<number> {
  const text = (await timeText(page).textContent()) ?? '';
  const [mm, ss] = (text.split('/')[0] ?? '').trim().split(':');
  return Number(mm) * 60 + Number(ss);
}

/** Lane elements in display order (same order as the track panels). */
export const lanes = (page: Page) => page.locator('.lane');

/** px per second of the timeline, derived from a lane's width and its track's length. */
export async function pxPerSecond(page: Page, laneIndex: number, trackSeconds: number) {
  const box = await lanes(page).nth(laneIndex).boundingBox();
  if (!box) throw new Error('lane is not visible');
  return box.width / trackSeconds;
}

/** Whether a lane's wavesurfer canvas (inside shadow roots) has actually painted something. */
export function laneHasWaveform(lane: Locator): Promise<boolean> {
  return lane.evaluate((el) => {
    const find = (root: ParentNode): HTMLCanvasElement | null => {
      const canvas = root.querySelector('canvas');
      if (canvas) return canvas;
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node.shadowRoot) {
          const found = find(node.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    const canvas = find(el);
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) return false;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  });
}
