// Throwaway (M2): the whole recording flow in a real Chromium against the dev stack, using
// Chromium's fake microphone: record over an uploaded track -> live lane and meter -> mute ->
// stop -> encode (real FLAC worker) -> draft -> latency -> upload -> new track; then crash recovery.
// Needs: docker compose -f docker-compose.dev.yml up -d, pnpm db:migrate, pnpm dev.
// Usage (from spike/): BASE=http://localhost:5175 TONE=/path/to/tone.wav node probe/m2-record-smoke.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const TONE = process.env.TONE;
if (!TONE) throw new Error('set TONE to a short .wav file');

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 }, permissions: ['microphone'] });
const problems = [];
const watch = (page) => {
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`console.${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
};
let page = await ctx.newPage();
watch(page);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const step = (n) => console.log(`\n== ${n}`);

step('create a project with one backing track');
await page.goto(BASE);
await page.getByRole('button', { name: 'Create project' }).click();
await page.getByLabel('Title').fill(`M2 record ${Date.now()}`);
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.waitForURL(/\/project\/\d+/);
const projectId = Number(page.url().match(/project\/(\d+)/)[1]);
await page.getByLabel(/add audio files/i).setInputFiles(TONE);
const zone = page.getByTestId('drop-zone');
await zone.getByLabel('Name', { exact: true }).fill('Backing');
await zone.getByRole('button', { name: 'Upload', exact: true }).click();
await page.waitForFunction(() => !document.querySelector('.upload-items li'), null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.track-panel').length === 1 && !document.querySelector('.lane-status'), null, { timeout: 30000 });
check('backing track loaded', (await page.locator('.track-panel').count()) === 1);

step('input check before recording');
await page.getByRole('button', { name: /check input level/i }).click();
await page.waitForFunction(() => document.querySelector('meter')?.value > 0.01, null, { timeout: 15000 }).catch(() => {});
const meterBefore = await page.evaluate(() => document.querySelector('meter')?.value ?? -1);
check('meter moves in input-check mode', meterBefore > 0.01, `meter=${meterBefore.toFixed?.(2)}`);
await page.keyboard.press('m');
await page.waitForTimeout(400);
check('M mutes the input check', (await page.getByRole('button', { name: 'Mic muted' }).count()) === 1);
await page.keyboard.press('m');
await page.getByRole('button', { name: /stop checking/i }).click();

step('record at the playhead, over the backing track');
const posText = () => page.getByTestId('time').textContent();
await page.keyboard.press('r');
await page.getByRole('button', { name: /stop recording/i }).waitFor({ timeout: 15000 });
check('R starts recording (button shows Stop)', true);
await page.waitForTimeout(3500);
const recBtn = page.getByRole('button', { name: /stop recording/i });
const recText = (await recBtn.textContent()) ?? '';
check('button shows elapsed time', /0:0[2-5]/.test(recText), recText.trim());
check('record button is red', (await recBtn.getAttribute('class'))?.includes('recording'));
const laneCount = await page.getByTestId('lane-recording').count();
check('live recording lane is shown', laneCount === 1);
const ink = await page.evaluate(() => {
  const c = document.querySelector('canvas.recording-canvas');
  if (!c) return -1;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});
check('live waveform has been drawn', ink > 50, `${ink} painted px`);
check('playhead advances during the take', /^00:0[2-9]/.test(await posText()), await posText());
check('seek is locked while recording', await page.getByRole('button', { name: 'Restart' }).isDisabled());
await page.keyboard.press('m');
check('M mutes the take', (await page.getByRole('button', { name: 'Mic muted' }).count()) === 1);
await page.waitForTimeout(700);
await page.keyboard.press('m');
await page.waitForTimeout(700);
await page.keyboard.press('r');

step('stop: encode in the worker, draft appears');
await page.waitForSelector('[data-testid^="panel-draft-"]', { timeout: 30000 });
const draftPanel = page.locator('[data-testid^="panel-draft-"]').first();
check('draft panel appears, marked Draft', (await draftPanel.textContent()).includes('Draft'));
check('name defaults to Take 1', (await draftPanel.getByLabel('Take name').inputValue()) === 'Take 1');
check('draft lane is drawn', (await page.locator('[data-testid^="lane-draft-"]').count()) === 1);
check('transport unlocked again', !(await page.getByRole('button', { name: 'Restart' }).isDisabled()));

step('align by ear: latency offset, then upload');
await draftPanel.getByLabel('Latency offset (ms)').fill('-50');
await draftPanel.getByLabel('Performer').fill('Ann');
await draftPanel.getByLabel('Performer').press('Enter');
await page.waitForTimeout(900); // debounce + save
await draftPanel.getByRole('button', { name: /upload take 1/i }).click();
await page.waitForFunction(() => !document.querySelector('[data-testid^="panel-draft-"]'), null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.track-panel').length === 2, null, { timeout: 30000 });
check('draft replaced by an uploaded track', (await page.locator('.track-panel').count()) === 2);

const detail = await (await fetch(`${BASE}/api/projects/${projectId}`)).json();
const rec = detail.tracks.find((t) => t.source === 'recording');
check('server has a recording track', !!rec, rec ? `${rec.mimeType}, ${rec.durationMs} ms, start ${rec.startOffsetMs} ms, latency ${rec.latencyOffsetMs} ms, performer ${rec.performer}` : 'none');
check('it is FLAC, about 4-5 s long', rec?.mimeType === 'audio/flac' && rec.durationMs > 3500 && rec.durationMs < 6500);
check('latency offset -50 was saved with it', rec?.latencyOffsetMs === -50);
check('performer saved', rec?.performer === 'Ann');
check('peaks were sent', (rec?.peaks?.length ?? 0) > 100);

step('reload: uploaded track persists, no draft left');
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.track-panel').length === 2, null, { timeout: 30000 });
check('no draft after reload', (await page.locator('[data-testid^="panel-draft-"]').count()) === 0);

step('crash recovery: kill the tab mid-take');
await page.keyboard.press('r');
await page.getByRole('button', { name: /stop recording/i }).waitFor({ timeout: 15000 });
await page.waitForTimeout(4500);
await page.close({ runBeforeUnload: false });
page = await ctx.newPage();
watch(page);
await page.goto(`${BASE}/project/${projectId}`);
await page.waitForSelector('[data-testid^="panel-draft-"]', { timeout: 30000 });
const recovered = page.locator('[data-testid^="lane-draft-"]').first();
const widthPx = Number.parseFloat(await recovered.evaluate((el) => el.style.width));
check('the cut-short take is recovered as a draft', (await page.locator('[data-testid^="panel-draft-"]').count()) === 1, `lane ${widthPx.toFixed(0)} px wide`);
check('recovered take has audio (>= ~2 s at the default zoom)', widthPx > 100);

console.log('\n== console problems:', problems.length ? '\n' + problems.join('\n') : 'none');
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
