// Throwaway (M2): does getUserMedia resolve with Chromium's fake device on this machine?
// Bounded: gives up after 8 s per variant. Usage (from spike/): node probe/m2-fakemic-check.mjs
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>mic</title><body>mic</body>');
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const variants = {
  'headless, fake device + fake ui': { headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  'headed, fake device + fake ui': { headless: false, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
};

for (const [name, opts] of Object.entries(variants)) {
  let browser;
  try {
    browser = await chromium.launch(opts);
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const page = await ctx.newPage();
    await page.goto(url);
    const result = await page.evaluate(
      () =>
        Promise.race([
          navigator.mediaDevices
            .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
            .then(async (s) => {
              const ctx = new AudioContext();
              await ctx.resume();
              return `resolved: ${s.getAudioTracks()[0].label}, ctx ${ctx.state} @${ctx.sampleRate} Hz`;
            })
            .catch((e) => `rejected: ${e.name}`),
          new Promise((r) => setTimeout(() => r('TIMEOUT (never resolved)'), 8000)),
        ]),
    );
    console.log(`${name}: ${result}`);
  } catch (e) {
    console.log(`${name}: FAILED to run: ${e.message.split('\n')[0]}`);
  } finally {
    await browser?.close();
  }
}
server.close();
