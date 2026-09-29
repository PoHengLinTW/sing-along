// Throwaway (M2-06): run the BUILT encode worker from apps/web/dist in real browsers, encode a
// synthetic take, time it, and check the output decodes with decodeAudioData.
// Usage: pnpm --filter @sing-along/web build && pnpm --filter @sing-along/web exec vite preview --port 4173
//        node probe/m2-encode-worker.mjs   (from spike/)
import { readdirSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';

const assets = new URL('../../apps/web/dist/assets/', import.meta.url);
const worker = readdirSync(assets).find((f) => f.startsWith('encode.worker-'));
if (!worker) throw new Error('build apps/web first');
const base = process.env.URL ?? 'http://localhost:4173';
const seconds = Number(process.env.SECONDS ?? 240);

for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  let browser;
  try {
    browser = await type.launch();
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${base}/`);
    const out = await page.evaluate(
      async ({ url, seconds }) => {
        const rate = 48000;
        const n = seconds * rate;
        const samples = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate) + 0.05 * (Math.random() - 0.5);
        }
        const w = new Worker(url, { type: 'module' });
        const t0 = performance.now();
        const progress = [];
        const msg = await new Promise((resolve, reject) => {
          w.onmessage = (e) => (e.data.type === 'progress' ? progress.push(e.data.fraction) : resolve(e.data));
          w.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
          w.postMessage({ samples, sampleRate: rate, trimSamples: 4800 }, [samples.buffer]);
        });
        const ms = performance.now() - t0;
        if (msg.type !== 'done') return { error: msg.message };
        const r = msg.result;
        const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, rate);
        let decoded = 'FAILED';
        try {
          const buf = await ctx.decodeAudioData(r.bytes.slice().buffer);
          decoded = `${buf.duration.toFixed(3)} s, ${buf.numberOfChannels} ch, ${buf.sampleRate} Hz`;
        } catch (e) {
          decoded = `FAILED: ${e.message}`;
        }
        return {
          mimeType: r.mimeType,
          fellBack: r.fellBack,
          bytes: r.bytes.length,
          durationMs: r.durationMs,
          peaks: r.peaks.length,
          ms: Math.round(ms),
          progressUpdates: progress.length,
          lastProgress: progress.at(-1),
          decoded,
        };
      },
      { url: `${base}/assets/${worker}`, seconds },
    );
    console.log(`\n=== ${name} ${browser.version()} (${seconds} s take) ===\n`, out);
  } catch (e) {
    console.log(`\n=== ${name} FAILED: ${e.message.split('\n')[0]}`);
  } finally {
    await browser?.close();
  }
}
