// Decode the four M0 input formats through the spike UI in one browser.
// Usage: node probe/formats-check.mjs <chromium|firefox|webkit> <mp3> <m4a> <wav> <flac>
import { chromium, firefox, webkit } from 'playwright';

const name = process.argv[2] ?? 'chromium';
const files = process.argv.slice(3);
const type = { chromium, firefox, webkit }[name];
if (!type) throw new Error(`Unknown browser: ${name}`);
if (files.length !== 4) throw new Error('Pass mp3, m4a, wav and flac test files in that order');
const browser = await type.launch();
try {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (error) => console.error('pageerror:', error.message));
  await page.goto('https://localhost:5173/');
  await page.setInputFiles('#files', files);
  await page.waitForFunction(() => (document.querySelector('#log').textContent.match(/Loaded |Cannot decode /g) ?? []).length === 4);
  console.log(`${name} ${browser.version()}`);
  console.log((await page.locator('#log').textContent()).split('\n').filter((line) => /Loaded |Cannot decode /.test(line)).join('\n'));
} finally {
  await browser.close();
}
