import { Engine, type EngineTrack } from './engine/engine';
import { decodedBytes } from './engine/memory';
import { encodeInWorker } from './encode/client';
import { ChunkWriter, TakeStore } from './capture/store';
import { Recorder } from './capture/recorder';
import { trimBeforeZero, takeDurationMs, type Take } from './capture/take';
import { RAW_MIC_CONSTRAINTS, checkMicSupport, describeMicError } from './mic';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const log = (msg: string) => {
  $('log').textContent += msg + '\n';
  console.log(msg);
};

const support = checkMicSupport({
  isSecureContext: window.isSecureContext,
  hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
});
$('env').textContent = `${location.origin} | secure=${window.isSecureContext} | mic support=${support.ok ? 'yes' : support.reason}`;
log(`Browser: ${navigator.userAgent}`);

$<HTMLSelectElement>('output-path').onchange = (event) => {
  log(`Output path: ${(event.target as HTMLSelectElement).value}`);
};

function reportText(): string {
  return `M0 spike report\n${new Date().toISOString()}\n${$('env').textContent}\n${$('log').textContent}`;
}

$('copy-report').onclick = async () => {
  try {
    await navigator.clipboard.writeText(reportText());
    log('Report copied to clipboard.');
  } catch (error) {
    log(`Could not copy report: ${(error as Error).message}. Use Download report instead.`);
  }
};

$('download-report').onclick = () => {
  const url = URL.createObjectURL(new Blob([reportText()], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'm0-spike-report.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$('enable-mic').addEventListener('click', async () => {
  if (!support.ok) return log(`Cannot use mic: ${support.reason}`);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_MIC_CONSTRAINTS });
    log('Mic granted. Settings: ' + JSON.stringify(stream.getAudioTracks()[0].getSettings()));
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    log(describeMicError(e as Error));
  }
});

// ---- M0-02: synced playback ----
let engine: Engine | null = null;
const getEngine = () => (engine ??= new Engine());

function renderTrack(t: EngineTrack): void {
  const e = getEngine();
  const div = document.createElement('div');
  div.className = 'track';
  div.innerHTML = `
    <strong>${t.name}</strong> (${t.buffer.duration.toFixed(1)}s, ${t.buffer.numberOfChannels}ch, ${t.buffer.sampleRate}Hz)
    <div>
      <label>Vol <input class="vol" type="range" min="0" max="1" step="0.01" value="1" /></label>
      <label><input class="mute" type="checkbox" /> Mute</label>
      <label><input class="solo" type="checkbox" /> Solo</label>
    </div>
    <div>
      <label>Latency <output class="lat-out">0</output> ms (applies on next play/seek)
        <input class="lat" type="range" min="-500" max="500" step="1" value="0" />
      </label>
    </div>`;
  div.querySelector<HTMLInputElement>('.vol')!.oninput = (ev) => e.setVolume(t, +(ev.target as HTMLInputElement).value);
  div.querySelector<HTMLInputElement>('.mute')!.onchange = (ev) => e.setMuted(t, (ev.target as HTMLInputElement).checked);
  div.querySelector<HTMLInputElement>('.solo')!.onchange = (ev) => e.setSolo(t, (ev.target as HTMLInputElement).checked);
  const lat = div.querySelector<HTMLInputElement>('.lat')!;
  lat.oninput = () => {
    e.setLatency(t, +lat.value);
    div.querySelector('.lat-out')!.textContent = String(t.latencyOffsetMs);
  };
  lat.onchange = () => log(`Aligned latency for ${t.name}: ${t.latencyOffsetMs} ms (${(document.querySelector('#output-path') as HTMLSelectElement).value})`);
  $('tracks').append(div);
}

$<HTMLInputElement>('files').onchange = async (ev) => {
  const e = getEngine();
  for (const file of Array.from((ev.target as HTMLInputElement).files ?? [])) {
    try {
      renderTrack(await e.addFile(file));
      log(`Loaded ${file.name} (${file.type || 'unknown type'})`);
    } catch (err) {
      log(`Cannot decode ${file.name} (${file.type}): ${(err as Error).message}`);
    }
  }
  $<HTMLInputElement>('seek').max = String(e.durationSec);
};

$('play').onclick = () => {
  const e = getEngine();
  void e.play().then(() => {
    const l = e.reportedLatencyMs;
    log(`Reported latency: base ${l.base.toFixed(1)} ms + output ${l.output.toFixed(1)} ms = ${(l.base + l.output).toFixed(1)} ms`);
  });
};
$('pause').onclick = () => getEngine().pause();
$<HTMLInputElement>('seek').oninput = (ev) => getEngine().seek(+(ev.target as HTMLInputElement).value);

let scrubbing = false;
$<HTMLInputElement>('seek').addEventListener('pointerdown', () => (scrubbing = true));
window.addEventListener('pointerup', () => (scrubbing = false));

function tick(): void {
  if (engine) {
    const pos = engine.position;
    $('time').textContent = `${pos.toFixed(2)} / ${engine.durationSec.toFixed(2)}`;
    if (!scrubbing) $<HTMLInputElement>('seek').value = String(pos);
  }
  requestAnimationFrame(tick);
}
tick();

// ---- M0-03: capture at the playhead ----
let recorder: Recorder | null = null;
let writer: ChunkWriter | null = null;
let currentTakeId: string | null = null;
const takes: Take[] = [];

$('record').onclick = async () => {
  if (!support.ok) return log(`Cannot record: ${support.reason}`);
  const e = getEngine();
  await e.play(); // sets the play anchor; the first captured frame is mapped onto the timeline from it
  const early: Float32Array[] = []; // chunks that arrive before the take row exists
  writer = null;
  recorder = new Recorder(e.ctx, { onChunk: (c) => (writer ? writer.push(c) : early.push(c)) });
  try {
    const firstCtxTime = await recorder.start();
    const startSec = e.playheadAtCtxTime(firstCtxTime);
    recorder.startSec = startSec;
    const store = await getStore();
    currentTakeId = await store.createTake({ sampleRate: e.ctx.sampleRate, startSec });
    writer = new ChunkWriter(store, currentTakeId); // ~1 flush per second
    early.forEach((c) => writer!.push(c));
    log(`Record settings: ${JSON.stringify(recorder.settings)}`);
    log(`ctx.sampleRate=${e.ctx.sampleRate}; first frame @ctx ${firstCtxTime.toFixed(3)} => timeline ${startSec.toFixed(3)}s`);
    $<HTMLButtonElement>('record').disabled = true;
    $<HTMLButtonElement>('stop-record').disabled = false;
  } catch (err) {
    log(describeMicError(err as Error));
    e.pause();
  }
};

$('stop-record').onclick = async () => {
  if (!recorder) return;
  const e = getEngine();
  const stopCtxTime = e.ctx.currentTime;
  const raw = await recorder.stop(0);
  log(`Raw capture: ${raw.samples.length} samples @${raw.sampleRate}Hz = ${(takeDurationMs(raw.samples.length, raw.sampleRate) / 1000).toFixed(3)}s`);
  await writer?.close();
  if (currentTakeId) await (await getStore()).finishTake(currentTakeId);
  writer = null;
  e.pause();
  const t = trimBeforeZero(raw.samples, raw.sampleRate, recorder.startSec);
  const take: Take = { samples: t.samples, sampleRate: raw.sampleRate, startOffsetMs: Math.round(t.startSec * 1000) };
  recorder = null;
  takes.push(take);
  log(`Take: ${take.samples.length} samples @${take.sampleRate}Hz = ${(takeDurationMs(take.samples.length, take.sampleRate) / 1000).toFixed(3)}s, startOffset ${take.startOffsetMs}ms; stop requested @ctx ${stopCtxTime.toFixed(3)}s`);
  const buf = e.ctx.createBuffer(1, take.samples.length, take.sampleRate);
  buf.copyToChannel(take.samples as Float32Array<ArrayBuffer>, 0);
  renderTrack(e.addBuffer(`Take ${takes.length}`, buf, take.startOffsetMs));
  void encodeAndCheck(`take-${takes.length}`, take.samples, take.sampleRate);
  $<HTMLInputElement>('seek').max = String(e.durationSec);
  $<HTMLButtonElement>('record').disabled = false;
  $<HTMLButtonElement>('stop-record').disabled = true;
};

// ---- M0-04: encode take to FLAC (+ WAV fallback) in a worker, then prove the browser can decode both ----
async function encodeAndCheck(label: string, samples: Float32Array, sampleRate: number): Promise<void> {
  const secs = samples.length / sampleRate;
  log(`Encoding ${label} (${secs.toFixed(1)}s @${sampleRate}Hz)...`);
  const r = await encodeInWorker(samples, sampleRate);
  const ctx = getEngine().ctx;
  const check = async (name: string, bytes: Uint8Array, mime: string) => {
    try {
      const buf = await ctx.decodeAudioData(bytes.slice().buffer);
      log(`  ${name}: decodeAudioData OK (${buf.duration.toFixed(2)}s, ${buf.numberOfChannels}ch, ${buf.sampleRate}Hz)`);
    } catch (err) {
      log(`  ${name}: decodeAudioData FAILED: ${(err as Error).message}`);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    a.download = `${label}.${name.toLowerCase()}`;
    a.textContent = `Download ${label}.${name.toLowerCase()} (${(bytes.length / 1e6).toFixed(2)} MB)`;
    a.style.display = 'block';
    $('downloads').append(a);
  };
  if (r.flac) {
    log(`  FLAC: ${(r.flac.length / 1e6).toFixed(2)} MB (${(r.flac.length / 1e6 / (secs / 60)).toFixed(2)} MB/min) in ${r.flacMs!.toFixed(0)} ms`);
    await check('FLAC', r.flac, 'audio/flac');
  } else {
    log(`  FLAC FAILED: ${r.flacError} -> falling back to WAV`);
  }
  log(`  WAV: ${(r.wav.length / 1e6).toFixed(2)} MB in ${r.wavMs.toFixed(0)} ms`);
  await check('WAV', r.wav, 'audio/wav');
}

$('bench-encode').onclick = async () => {
  const sr = getEngine().ctx.sampleRate;
  const x = new Float32Array(sr * 240);
  let seed = 1;
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    x[i] = (0.5 + 0.5 * Math.sin(i / 20000)) * (0.4 * Math.sin(i * 0.031) + 0.2 * Math.sin(i * 0.11)) + (seed / 2 ** 32 - 0.5) * 0.02;
  }
  await encodeAndCheck('bench-4min', x, sr);
};

// ---- M0-06: crash-safe chunks + recovery ----
let storePromise: Promise<TakeStore> | null = null;
const getStore = () => (storePromise ??= TakeStore.open());

async function checkRecovery(): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) log(`Storage quota: ${((est.quota ?? 0) / 1e9).toFixed(2)} GB, usage ${((est.usage ?? 0) / 1e6).toFixed(1)} MB`);
    const store = await getStore();
    const list = await store.listUnfinished();
    const box = $('recovery');
    box.textContent = list.length ? '' : 'No unfinished takes.';
    for (const meta of list) {
      const btn = document.createElement('button');
      const full = await store.loadTake(meta.id);
      const secs = full.samples.length / full.sampleRate;
      btn.textContent = `Recover take from ${new Date(meta.createdAt).toLocaleTimeString()} (${secs.toFixed(1)}s)`;
      btn.onclick = async () => {
        const e = getEngine();
        const t = trimBeforeZero(full.samples, full.sampleRate, full.startSec);
        const buf = e.ctx.createBuffer(1, t.samples.length, full.sampleRate);
        buf.copyToChannel(t.samples as Float32Array<ArrayBuffer>, 0);
        renderTrack(e.addBuffer(`Recovered ${secs.toFixed(1)}s`, buf, Math.round(t.startSec * 1000)));
        await store.finishTake(meta.id);
        btn.remove();
      };
      box.append(btn);
    }
  } catch (err) {
    log(`Recovery check failed: ${(err as Error).message}`);
  }
}
void checkRecovery();

// ---- M0-08: memory with N four-minute tracks (1 stereo + rest mono) ----
$('mem-load').onclick = async () => {
  const e = getEngine();
  const n = +$<HTMLInputElement>('mem-n').value;
  const sr = e.ctx.sampleRate;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const channels = i === 0 ? 2 : 1;
    const buf = e.ctx.createBuffer(channels, sr * 240, sr);
    for (let c = 0; c < channels; c++) {
      const d = buf.getChannelData(c);
      const f = 110 * (1 + i * 0.12);
      for (let k = 0; k < d.length; k++) d[k] = 0.1 * Math.sin((2 * Math.PI * f * k) / sr);
    }
    total += decodedBytes({ durationSec: 240, sampleRate: sr, channels });
    renderTrack(e.addBuffer(`Synthetic ${i + 1}${channels === 2 ? ' (stereo)' : ''}`, buf, 0));
    // yield so the tab stays responsive and a crash/reload is attributable to a track count
    await new Promise((r) => setTimeout(r));
    log(`Loaded ${i + 1}/${n}: ~${(total / 1e6).toFixed(0)} MB decoded PCM` + heapInfo());
  }
  $<HTMLInputElement>('seek').max = String(e.durationSec);
  await e.play();
  log(`Playing ${n} tracks. Listen for glitches; note peak memory in DevTools / Safari Web Inspector.`);
};

function heapInfo(): string {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? `, JS heap ${(m.usedJSHeapSize / 1e6).toFixed(0)} MB` : '';
}
