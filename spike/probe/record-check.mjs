// Throwaway: fake-mic recording in Chromium. (1) 60 s take sample count (M0-03). (2) kill tab at 30 s, recover (M0-06).
import { chromium } from 'playwright';
const url = process.env.URL ?? 'https://localhost:5173/';
const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'];
const text = (page) => page.evaluate(() => document.getElementById('log').textContent);

const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] });

// (1) 60 s take
let page = await ctx.newPage();
await page.goto(url);
await page.click('#record');
await page.waitForFunction(() => /first frame/.test(document.getElementById('log').textContent));
const wall0 = Date.now();
await page.waitForTimeout(60000);
await page.click('#stop-record');
await page.waitForFunction(() => /Take: /.test(document.getElementById('log').textContent));
const wall = (Date.now() - wall0) / 1000;
const log1 = await text(page);
console.log(log1.split('\n').filter((l) => /Record settings|sampleRate|Take:/.test(l)).join('\n'));
const m = log1.match(/Take: (\d+) samples @(\d+)Hz/);
const secs = m[1] / m[2];
console.log(`wall-clock between first frame and Stop click: ${wall.toFixed(2)} s; take length ${secs.toFixed(3)} s; diff ${((secs - wall) * 1000).toFixed(0)} ms`);
console.log(`|take - 60 s| = ${(Math.abs(secs - 60) * 1000).toFixed(0)} ms  (AC: within 50 ms, given the stop click lands at ~60 s)`);

// (2) crash recovery: record 30 s then kill the tab without pressing Stop
page = await ctx.newPage();
await page.goto(url);
await page.click('#record');
await page.waitForFunction(() => /first frame/.test(document.getElementById('log').textContent));
await page.waitForTimeout(30000);
await page.close({ runBeforeUnload: false });
const page2 = await ctx.newPage();
await page2.goto(url);
await page2.waitForFunction(() => !/Checking/.test(document.getElementById('recovery').textContent));
console.log('recovery UI:', (await page2.evaluate(() => document.getElementById('recovery').innerText)).replace(/\n/g, ' | '));
await browser.close();
