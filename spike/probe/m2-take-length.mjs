// Throwaway (M2-02): length of a 60 s take through the real pipeline (worklet -> IndexedDB -> FLAC),
// compared with the wall clock between the Stop button appearing and the stop key press.
// Usage (from spike/): BASE=http://localhost:5175 node probe/m2-take-length.mjs   (takes ~75 s)
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const SECONDS = Number(process.env.SECONDS ?? 60);
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
await page.goto(BASE);
await page.getByRole('button', { name: 'Create project' }).click();
await page.getByLabel('Title').fill(`M2 length ${Date.now()}`);
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.waitForURL(/\/project\/\d+/);

await page.getByRole('button', { name: 'Record', exact: true }).waitFor(); // the page has mounted
await page.keyboard.press('r');
await page.getByRole('button', { name: /stop recording/i }).waitFor({ timeout: 15000 });
const t0 = Date.now();
await page.waitForTimeout(SECONDS * 1000);
await page.keyboard.press('r');
const wall = (Date.now() - t0) / 1000;
await page.waitForSelector('[data-testid^="panel-draft-"]', { timeout: 60000 });

const draft = await page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open('sing-along-drafts');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const all = open.result.transaction('drafts').objectStore('drafts').getAll();
        all.onsuccess = () => {
          const d = all.result.at(-1);
          resolve({ durationMs: d.durationMs, startOffsetMs: d.startOffsetMs, sampleRate: d.sampleRate, bytes: d.blob.size, mime: d.mimeType });
        };
      };
    }),
);
console.log(`draft: ${draft.durationMs} ms @ ${draft.sampleRate} Hz, ${draft.mime}, ${(draft.bytes / 1e6).toFixed(2)} MB, start ${draft.startOffsetMs} ms`);
console.log(`wall clock (Stop shown -> stop pressed): ${(wall * 1000).toFixed(0)} ms`);
console.log(`take - wall: ${(draft.durationMs - wall * 1000).toFixed(0)} ms   |take - ${SECONDS} s|: ${Math.abs(draft.durationMs - SECONDS * 1000).toFixed(0)} ms`);
await browser.close();
