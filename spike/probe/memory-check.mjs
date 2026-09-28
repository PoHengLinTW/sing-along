// Throwaway: load N synthetic 4-min tracks in a desktop browser and report decoded size / JS heap.
import { chromium } from 'playwright';
const n = process.argv[2] ?? '10';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('https://localhost:5173/');
await page.fill('#mem-n', n);
await page.click('#mem-load');
await page.waitForFunction(() => /Playing \d+ tracks/.test(document.getElementById('log').textContent), null, { timeout: 120000 });
await page.waitForTimeout(5000);
const log = await page.evaluate(() => document.getElementById('log').textContent);
console.log(log.split('\n').filter((l) => /Loaded (1|5|10)\/|Playing/.test(l)).join('\n'));
console.log('position after 5s:', await page.evaluate(() => document.getElementById('time').textContent));
await browser.close();
