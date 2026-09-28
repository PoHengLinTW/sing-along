import { Engine, type EngineTrack } from './engine/engine';
import { encodeInWorker } from './encode/client';
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
const takes: Take[] = [];

$('record').onclick = async () => {
  if (!support.ok) return log(`Cannot record: ${support.reason}`);
  const e = getEngine();
  await e.play(); // sets the play anchor; the first captured frame is mapped onto the timeline from it
  recorder = new Recorder(e.ctx);
  try {
    const firstCtxTime = await recorder.start();
    const startSec = e.playheadAtCtxTime(firstCtxTime);
    recorder.startSec = startSec;
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
  const raw = await recorder.stop(0);
  e.pause();
  const t = trimBeforeZero(raw.samples, raw.sampleRate, recorder.startSec);
  const take: Take = { samples: t.samples, sampleRate: raw.sampleRate, startOffsetMs: Math.round(t.startSec * 1000) };
  recorder = null;
  takes.push(take);
  log(`Take: ${take.samples.length} samples @${take.sampleRate}Hz = ${(takeDurationMs(take.samples.length, take.sampleRate) / 1000).toFixed(3)}s, startOffset ${take.startOffsetMs}ms`);
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
