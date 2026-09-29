import Multitrack from 'wavesurfer-multitrack';
import WaveSurfer from 'wavesurfer.js';
import { Engine } from './engine/engine';
import { computePeaks, trackLeftPx } from './waveform/peaks';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (m: string) => {
  $('log').textContent += m + '\n';
  console.log(m);
};
const pxPerSec = () => +$<HTMLInputElement>('zoom').value;
const offsets = () => $<HTMLInputElement>('offsets').value.split(',').map((s) => +s.trim() || 0);

let files: File[] = [];
let mt: Multitrack | null = null;
let engine: Engine | null = null;
const surfers: { ws: WaveSurfer; lane: HTMLElement; track: import('./engine/engine').EngineTrack }[] = [];

$<HTMLInputElement>('files').onchange = async (ev) => {
  files = Array.from((ev.target as HTMLInputElement).files ?? []);
  await buildA();
  await buildB();
};

// ---- (a) multitrack plugin: playback + render ----
async function buildA(): Promise<void> {
  mt?.destroy();
  $('a-stage').innerHTML = '';
  const off = offsets();
  mt = Multitrack.create(
    files.map((f, i) => ({
      id: i,
      url: URL.createObjectURL(f),
      startPosition: (off[i] ?? 0) / 1000,
      draggable: false,
      options: { waveColor: '#4a90d9', progressColor: '#245' },
    })),
    { container: $('a-stage'), minPxPerSec: pxPerSec(), cursorColor: 'red' },
  );
  mt.once('canplay', () => log(`(a) multitrack ready: ${files.length} tracks`));
}
$('a-play').onclick = () => (mt?.isPlaying() ? mt.pause() : mt?.play());

let aProbe = 0;
$('a-probe').onclick = () => {
  if (!mt) return;
  clearInterval(aProbe);
  const t0 = performance.now();
  const off = offsets();
  mt.play();
  log('(a) drift probe started: signed track errors vs shared playhead and inter-track spread, every 10 s');
  aProbe = window.setInterval(() => {
    const m = mt as unknown as { audios: HTMLAudioElement[]; getCurrentTime(): number };
    const now = m.getCurrentTime();
    // multitrack keeps one extra audio (the drop-target track) after ours: only look at our tracks
    const errs = m.audios.map((a, i) => {
      if (i >= files.length || a.paused) return NaN;
      return (a.currentTime - (now - (off[i] ?? 0) / 1000)) * 1000;
    });
    const finite = errs.filter((e) => !Number.isNaN(e));
    const spread = finite.length > 1 ? Math.max(...finite) - Math.min(...finite) : NaN;
    log(`(a) t=${((performance.now() - t0) / 1000).toFixed(0)}s wall, playhead ${now.toFixed(2)}s, inter-track spread ${Number.isNaN(spread) ? 'n/a' : spread.toFixed(1)} ms (signed track errors ms: ${errs.map((e) => (Number.isNaN(e) ? '-' : e.toFixed(0))).join('/')})`);
  }, 10000);
};

// ---- (b) our engine plays; wavesurfer renders peaks only (no audio decode by wavesurfer) ----
async function buildB(): Promise<void> {
  engine = new Engine();
  $('b-lanes').innerHTML = '';
  surfers.length = 0;
  const off = offsets();
  for (const [i, f] of files.entries()) {
    const t = await engine.addFile(f);
    t.startOffsetMs = off[i] ?? 0;
    const lane = document.createElement('div');
    lane.className = 'lane';
    const inner = document.createElement('div');
    lane.append(inner);
    $('b-lanes').append(lane);
    const peaks = computePeaks(t.buffer.getChannelData(0), Math.ceil(t.buffer.duration * 100)); // 100 peaks/sec
    const ws = WaveSurfer.create({
      container: inner,
      peaks: [peaks],
      duration: t.buffer.duration, // with peaks + duration, no audio is fetched or decoded
      height: 70,
      waveColor: '#4a90d9',
      interact: false,
      minPxPerSec: pxPerSec(),
      hideScrollbar: true,
    });
    surfers.push({ ws, lane: inner, track: t });
  }
  layoutB();
  log(`(b) rendered ${files.length} tracks from precomputed peaks; positioned by start offset`);
}

function layoutB(): void {
  for (const s of surfers) {
    s.ws.setOptions({ minPxPerSec: pxPerSec() }); // zoom() needs decoded audio; setOptions works with peaks only
    s.lane.style.left = `${trackLeftPx(s.track, pxPerSec())}px`;
    s.lane.style.width = `${s.track.buffer.duration * pxPerSec()}px`;
  }
}
$('zoom').oninput = () => {
  layoutB();
  mt?.zoom(pxPerSec());
};

$('b-play').onclick = () => (engine?.playing ? engine.pause() : void engine?.play());

let bProbe = 0;
$('b-probe').onclick = () => {
  if (!engine) return;
  clearInterval(bProbe);
  const e = engine;
  void e.play().then(() => log(`(b) playback started, context ${e.ctx.state}`)).catch((error) => log(`(b) playback failed: ${error.message}`));
  const t0 = performance.now();
  const c0 = e.ctx.currentTime;
  log('(b) sync probe: rendered playhead vs AudioContext timeline, ctx vs wall clock, and reported output latency');
  bProbe = window.setInterval(() => {
    const wall = (performance.now() - t0) / 1000;
    const ctxElapsed = e.ctx.currentTime - c0;
    const renderedSec = Number.parseFloat($('b-playhead').style.left || '0') / pxPerSec();
    const playheadErrorMs = (renderedSec - e.position) * 1000;
    const l = e.reportedLatencyMs;
    log(`(b) wall ${wall.toFixed(1)}s, state ${e.ctx.state}, playing ${e.playing}, ctx ${ctxElapsed.toFixed(3)}s, ctx-wall ${((ctxElapsed - wall) * 1000).toFixed(1)} ms, rendered-playhead ${playheadErrorMs.toFixed(1)} ms, reported latency ${(l.base + l.output).toFixed(1)} ms`);
  }, 10000);
};

function frame(): void {
  if (engine) $('b-playhead').style.left = `${engine.position * pxPerSec()}px`;
  requestAnimationFrame(frame);
}
frame();
