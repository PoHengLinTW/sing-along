import { expect, test } from '@playwright/test';
import { apiCreateProject } from '../support/api';
import { wavFile } from '../support/audio';
import { deleteProjectsAfterEachTest } from '../support/cleanup';
import {
  createProjectViaUi,
  currentSeconds,
  laneHasWaveform,
  lanes,
  panel,
  timeText,
  uniqueTitle,
  uploadTrackViaUi,
} from '../support/ui';

deleteProjectsAfterEachTest();

// M1-11 (upload flow), M1-12 (waveform appears), M3-10 flow 1 (create -> upload with a label ->
// waveform -> play -> the time advances).

test('create a project, upload a labelled track, see its waveform, play it: time advances', async ({
  page,
}) => {
  await createProjectViaUi(page);
  await uploadTrackViaUi(page, 'Alto line', { seconds: 20, performer: 'Sam', labels: ['Alto'] });

  const track = panel(page, 'Alto line');
  await expect(track).toBeVisible();
  await expect(track.getByLabel('Performer')).toHaveValue('Sam');
  await expect(track.getByText('Alto')).toBeVisible(); // the label chip
  await expect(lanes(page)).toHaveCount(1);
  const lane = lanes(page).first();
  await expect(lane).toBeVisible();
  expect((await lane.boundingBox())?.width).toBeGreaterThan(100);
  await expect.poll(() => laneHasWaveform(lane)).toBe(true); // painted from the stored peaks

  await expect(timeText(page)).toContainText('00:00.0');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(() => currentSeconds(page), { timeout: 8000 }).toBeGreaterThan(1);
});

test('the performer name is remembered for the next upload in this browser', async ({ page }) => {
  await createProjectViaUi(page);
  await uploadTrackViaUi(page, 'First', { performer: 'Remembered Rita' });
  await page.getByLabel(/add audio files/i).setInputFiles(wavFile('second.wav', 2));
  await expect(page.locator('.upload-items > li').last().getByLabel('Performer')).toHaveValue(
    'Remembered Rita',
  );
});

test('the name defaults to the file name', async ({ page }) => {
  await createProjectViaUi(page);
  await page.getByLabel(/add audio files/i).setInputFiles(wavFile('Soprano descant.wav', 2));
  await expect(
    page.locator('.upload-items > li').first().getByLabel('Name', { exact: true }),
  ).toHaveValue('Soprano descant');
});

test('an unsupported file is rejected before anything is uploaded', async ({ page, request }) => {
  const { id } = await apiCreateProject(request, uniqueTitle('Unsupported'));
  await page.goto(`/project/${id}`);
  await page.getByLabel(/add audio files/i).setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not audio'),
  });
  await expect(page.getByText('notes.txt: Unsupported format.')).toBeVisible();
  await expect(page.locator('.upload-items > li')).toHaveCount(0);
});

test('a file that is not really audio is refused with a clear message', async ({
  page,
  request,
}) => {
  const { id } = await apiCreateProject(request, uniqueTitle('Broken'));
  await page.goto(`/project/${id}`);
  await page.getByLabel(/add audio files/i).setInputFiles({
    name: 'broken.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('RIFF....this is not a wav file'),
  });
  await page.locator('.upload-items > li').first().getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(/could not be read as audio/i)).toBeVisible();
  await expect(page.locator('.track-panel')).toHaveCount(0);
});

test('several files at once upload one after another, each with its own form', async ({ page }) => {
  await createProjectViaUi(page);
  await page
    .getByLabel(/add audio files/i)
    .setInputFiles([wavFile('Tenor.wav', 2, { freq: 260 }), wavFile('Bass.wav', 2, { freq: 130 })]);
  await expect(page.locator('.upload-items > li')).toHaveCount(2);
  await page
    .locator('.upload-items > li')
    .nth(1)
    .getByLabel('Name', { exact: true })
    .fill('Bass part');
  await page.getByRole('button', { name: 'Upload all' }).click();
  await expect(page.locator('.track-panel')).toHaveCount(2);
  await expect(panel(page, 'Tenor')).toBeVisible();
  await expect(panel(page, 'Bass part')).toBeVisible();
  await expect(page.locator('.upload-items > li')).toHaveCount(0);
});

test('a track shows up in the list and count after uploading, without a reload', async ({
  page,
}) => {
  const { title } = await createProjectViaUi(page);
  await uploadTrackViaUi(page, 'Lead', { seconds: 2 });
  await page.getByRole('link', { name: 'Sing-along' }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toContainText('1 track');
});

test('progress is shown and cancelling stops the upload, which can then be retried', async ({
  page,
}) => {
  await createProjectViaUi(page);
  // Hold the PUT to storage so there is time to see progress and cancel.
  await page.route(/\/sing-along-e2e\/.*\.wav/, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await new Promise((r) => setTimeout(r, 4000));
    await route.abort();
  });
  await page.getByLabel(/add audio files/i).setInputFiles(wavFile('slow.wav', 5));
  const item = page.locator('.upload-items > li').first();
  await item.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(item.getByRole('progressbar')).toBeVisible();
  await item.getByRole('button', { name: 'Cancel upload' }).click();
  await expect(item.getByText(/cancelled/i)).toBeVisible();
  await expect(page.locator('.track-panel')).toHaveCount(0);

  await page.unroute(/\/sing-along-e2e\/.*\.wav/);
  await item.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.locator('.track-panel')).toHaveCount(1);
});
