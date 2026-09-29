// Throwaway: M1 exit criteria against the real dev stack in headless Chromium.
import { chromium } from 'playwright';

const S = '/private/tmp/claude-501/-Users-henrylin-ai-sing-along/83ed5b80-c7ac-4a95-8e65-1e7120665c7f/scratchpad';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`console.${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const step = (name) => console.log(`\n== ${name}`);
const time = () => page.getByTestId('time').textContent();
const posSeconds = async () => {
  const t = (await time()).split(' / ')[0]; // mm:ss.s
  const [m, s] = t.split(':');
  return Number(m) * 60 + Number(s);
};

step('create project');
await page.goto(BASE);
await page.getByRole('button', { name: 'Create project' }).click();
await page.getByLabel('Title').fill('M1 exit ' + Date.now());
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.waitForURL(/\/project\/\d+/);

step('upload three tracks with labels');
const files = ['tone0.wav', 'tone1.wav', 'tone2.wav'].map((f) => `${S}/${f}`);
// short files: reuse the 5 s tone three times under different names
const short = `${S}/short.wav`;
for (const [i, label] of [[0, 'Alto'], [1, 'Bass'], [2, 'Lead']]) {
  await page.getByLabel(/add audio files/i).setInputFiles(short);
  const zone = page.getByTestId('drop-zone');
  await zone.getByLabel('Name', { exact: true }).fill(`Part ${i + 1}`);
  await zone.getByRole('checkbox', { name: label }).check();
  await zone.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.upload-items li'), null, { timeout: 30000 });
}
await page.waitForFunction(() => document.querySelectorAll('.track-panel').length === 3);
await page.waitForFunction(() => !document.querySelector('.lane-status'), null, { timeout: 30000 });
console.log('tracks on screen:', await page.locator('.track-panel').count(), '| chips:', await page.getByTestId('label-chip').allTextContents());

step('play in sync');
await page.getByRole('button', { name: 'Play' }).click();
await page.waitForTimeout(1500);
const p1 = await posSeconds();
await page.waitForTimeout(1000);
const p2 = await posSeconds();
console.log('position advances:', p1, '->', p2, p2 > p1 ? 'OK' : 'FAIL');
await page.getByRole('button', { name: 'Pause' }).click();

step('mix: volume, mute, solo');
const part1 = page.getByTestId('panel-Part 1');
await part1.getByLabel('Volume').fill('70');
await part1.getByRole('button', { name: 'Mute' }).click();
await page.getByTestId('panel-Part 2').getByRole('button', { name: 'Solo' }).click();
console.log('mute pressed:', await part1.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed'));

step('seek by clicking the waveform lane');
await page.getByTestId('timeline-content').click({ position: { x: 120, y: 60 } });
console.log('position after click at ~120px (50 px/s):', await time());

step('loop a section (Set A / Set B) and watch it wrap');
await page.getByRole('button', { name: 'Restart' }).click();
await page.getByTestId('timeline-content').click({ position: { x: 50, y: 60 } }); // ~1 s
await page.getByRole('button', { name: 'Set loop start (A)' }).click();
await page.getByTestId('timeline-content').click({ position: { x: 150, y: 60 } }); // ~3 s
await page.getByRole('button', { name: 'Set loop end (B)' }).click();
console.log('loop:', await page.getByTestId('loop-range').textContent());
await page.getByTestId('timeline-content').click({ position: { x: 50, y: 60 } });
await page.getByRole('button', { name: 'Play' }).click();
const seen = [];
for (let i = 0; i < 30; i++) {
  seen.push(await posSeconds());
  await page.waitForTimeout(200);
}
const max = Math.max(...seen);
const wrapped = seen.some((v, i) => i > 0 && v < seen[i - 1] - 0.5);
console.log('positions over 6 s:', seen.map((v) => v.toFixed(1)).join(' '));
console.log('max position', max.toFixed(1), '(loop end 3.0)', '| wrapped back to A:', wrapped ? 'OK' : 'FAIL');
await page.getByRole('button', { name: 'Pause' }).click();
await page.screenshot({ path: `${S}/m1-exit.png` });

step('keyboard shortcut ignored in a text field');
await part1.getByLabel('Performer').focus();
await page.keyboard.press('Space');
console.log('still paused after Space in a text field:', (await page.getByRole('button', { name: 'Play' }).count()) === 1 ? 'OK' : 'FAIL');

step('label filter hides but keeps track');
await page.getByRole('button', { name: 'Show only Bass' }).click();
console.log('panels visible with Bass filter:', await page.locator('.track-panel').count());
await page.getByRole('button', { name: 'Clear filter' }).click();

step('reload restores the mix');
await page.reload();
await page.waitForSelector('.track-panel');
console.log('volume after reload:', await page.getByTestId('panel-Part 1').getByLabel('Volume').inputValue(), '| muted:', await page.getByTestId('panel-Part 1').getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed'));

step('deletes ask for confirmation');
await page.getByRole('button', { name: 'Delete Part 3' }).click();
console.log('track confirm dialog:', (await page.getByRole('dialog').textContent()).replace(/\s+/g, ' ').slice(0, 80));
await page.getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('button', { name: 'Delete project' }).click();
const del = page.getByRole('button', { name: 'Delete', exact: true });
console.log('project delete disabled until title typed:', await del.isDisabled());
await page.getByRole('button', { name: 'Cancel' }).click();

console.log('\nconsole problems:', problems.length ? problems : 'none');
await browser.close();
