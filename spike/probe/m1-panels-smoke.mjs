import { chromium } from 'playwright';

const S = '/private/tmp/claude-501/-Users-henrylin-ai-sing-along/83ed5b80-c7ac-4a95-8e65-1e7120665c7f/scratchpad';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log('console.' + m.type(), m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
const list = await (await fetch('http://localhost:5173/api/projects')).json();
const withTrack = list.find((p) => p.trackCount > 0);
await page.goto('http://localhost:5173/project/' + withTrack.id);
await page.waitForSelector('.track-panel');
await page.waitForFunction(() => !document.querySelector('.lane-status'), null, { timeout: 15000 });
await page.screenshot({ path: `${S}/view2.png` });
const rows = await page.evaluate(() => ({
  panelTop: document.querySelector('.track-panel')?.getBoundingClientRect().top,
  laneTop: document.querySelector('.lane')?.getBoundingClientRect().top,
  panelH: document.querySelector('.track-panel')?.getBoundingClientRect().height,
  laneH: document.querySelector('.lane')?.getBoundingClientRect().height,
}));
console.log(rows);
await browser.close();
