import { Engine, type EngineTrack } from './engine/engine';
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
    </div>`;
  div.querySelector<HTMLInputElement>('.vol')!.oninput = (ev) => e.setVolume(t, +(ev.target as HTMLInputElement).value);
  div.querySelector<HTMLInputElement>('.mute')!.onchange = (ev) => e.setMuted(t, (ev.target as HTMLInputElement).checked);
  div.querySelector<HTMLInputElement>('.solo')!.onchange = (ev) => e.setSolo(t, (ev.target as HTMLInputElement).checked);
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

$('play').onclick = () => void getEngine().play();
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
