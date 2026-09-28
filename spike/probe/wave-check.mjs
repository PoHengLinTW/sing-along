// Throwaway: run the (a) multitrack and (b) engine probes in a real browser for ~5 min.
// Usage: node probe/wave-check.mjs <a|b> <browser> <seconds> <file1> <file2> <file3>
import { chromium, firefox, webkit } from 'playwright';
const [which, bname, secs, ...files] = process.argv.slice(2);
const type = { chromium, firefox, webkit }[bname];
const browser = await type.launch({ args: bname === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('https://localhost:5173/wave.html');
await page.setInputFiles('#files', files);
const ready = which === 'a' ? /\(a\) multitrack ready/ : /\(b\) rendered/;
await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('log').textContent), ready.source, { timeout: 20000 });
const before = await page.evaluate(() => document.getElementById('log').textContent);
console.log(before.trim());
await page.click(`#${which}-probe`);
await page.waitForTimeout(secs * 1000 + 2000);
console.log('probe finished');
const out = await page.evaluate(() => document.getElementById('log').textContent);
console.log(`--- ${which} ${bname} ${browser.version()} ---`);
console.log(out.split('\n').filter((l) => l.startsWith(`(${which})`)).join('\n'));
await browser.close();
