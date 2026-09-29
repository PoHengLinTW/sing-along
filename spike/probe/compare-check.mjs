// Run both independent FLAC implementations against the same synthetic take.
// Usage: node probe/compare-check.mjs [chromium|firefox|webkit]
import { chromium, firefox, webkit } from 'playwright';

const name = process.argv[2] ?? 'chromium';
const type = { chromium, firefox, webkit }[name];
if (!type) throw new Error(`Unknown browser: ${name}`);
const browser = await type.launch();
try {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (error) => console.error('pageerror:', error.message));
  await page.goto('https://localhost:5173/compare.html');
  await page.click('#run');
  await page.waitForFunction(() => /Comparison (complete|failed)/.test(document.querySelector('#log').textContent), null, { timeout: 120000 });
  console.log(`${name} ${browser.version()}`);
  console.log((await page.locator('#log').textContent()).trim());
} finally {
  await browser.close();
}
