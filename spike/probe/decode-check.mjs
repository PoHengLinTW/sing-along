// Throwaway: encode a take with our worker code path in real browsers and check decodeAudioData on FLAC + WAV.
// Usage: pnpm dev (in another shell), then: node probe/decode-check.mjs
import { chromium, firefox, webkit } from 'playwright';

const url = process.env.URL ?? 'https://localhost:5173/';
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  let browser;
  try {
    browser = await type.launch();
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    const lines = [];
    page.on('console', (m) => lines.push(m.text()));
    await page.goto(url);
    await page.click('#bench-encode');
    await page.waitForFunction(() => /WAV: .* ms/.test(document.getElementById('log').textContent) && /WAV: decodeAudioData/.test(document.getElementById('log').textContent), null, { timeout: 60000 });
    const out = await page.evaluate(() => document.getElementById('log').textContent);
    console.log(`\n=== ${name} ${browser.version()} ===\n${out.trim()}`);
  } catch (e) {
    console.log(`\n=== ${name} FAILED: ${e.message.split('\n')[0]}`);
  } finally {
    await browser?.close();
  }
}
