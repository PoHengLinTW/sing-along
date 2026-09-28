import { effectiveGain, placeTrack } from './timing';

export interface EngineTrack {
  id: string;
  name: string;
  buffer: AudioBuffer;
  startOffsetMs: number;
  latencyOffsetMs: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

const START_LEAD_SEC = 0.1;
const GAIN_SMOOTH_SEC = 0.01;

/** Web Audio playback engine: one AudioBufferSourceNode + GainNode per track, all scheduled on one clock. */
export class Engine {
  readonly ctx: AudioContext;
  readonly tracks: EngineTrack[] = [];
  playing = false;
  private anchorCtxTime = 0;
  private anchorPlayhead = 0;
  private pausedPlayhead = 0;

  constructor(ctx: AudioContext = new AudioContext()) {
    this.ctx = ctx;
  }

  async addFile(file: File): Promise<EngineTrack> {
    const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    return this.addBuffer(file.name, buffer, 0);
  }

  addBuffer(name: string, buffer: AudioBuffer, startOffsetMs: number): EngineTrack {
    const gain = this.ctx.createGain();
    gain.connect(this.ctx.destination);
    const track: EngineTrack = {
      id: crypto.randomUUID(),
      name,
      buffer,
      startOffsetMs,
      latencyOffsetMs: 0,
      volume: 1,
      muted: false,
      solo: false,
      gain,
      source: null,
    };
    this.tracks.push(track);
    this.applyGains();
    if (this.playing) this.startSources(this.position);
    return track;
  }

  get durationSec(): number {
    return Math.max(0, ...this.tracks.map((t) => this.trackStartSec(t) + t.buffer.duration));
  }

  get position(): number {
    if (!this.playing) return this.pausedPlayhead;
    const elapsed = Math.max(0, this.ctx.currentTime - this.anchorCtxTime); // 0 during the start lead
    return Math.min(this.anchorPlayhead + elapsed, this.durationSec);
  }

  private trackStartSec(t: EngineTrack): number {
    return (t.startOffsetMs + t.latencyOffsetMs) / 1000;
  }

  async play(): Promise<void> {
    if (this.playing) return;
    await this.ctx.resume();
    this.startSources(this.pausedPlayhead);
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedPlayhead = this.position;
    this.stopSources();
    this.playing = false;
  }

  seek(sec: number): void {
    const target = Math.max(0, sec);
    if (this.playing) {
      this.stopSources();
      this.startSources(target);
    } else {
      this.pausedPlayhead = target;
    }
  }

  /** Latency changes apply on next play or seek (per task M0-05). */
  setLatency(t: EngineTrack, ms: number): void {
    t.latencyOffsetMs = ms;
  }

  setVolume(t: EngineTrack, v: number): void {
    t.volume = v;
    this.applyGains();
  }

  setMuted(t: EngineTrack, m: boolean): void {
    t.muted = m;
    this.applyGains();
  }

  setSolo(t: EngineTrack, s: boolean): void {
    t.solo = s;
    this.applyGains();
  }

  private applyGains(): void {
    const anySolo = this.tracks.some((t) => t.solo);
    for (const t of this.tracks) {
      // setTargetAtTime avoids zipper clicks on live volume changes.
      t.gain.gain.setTargetAtTime(effectiveGain(t, anySolo), this.ctx.currentTime, GAIN_SMOOTH_SEC);
    }
  }

  private startSources(playhead: number): void {
    const t0 = this.ctx.currentTime + START_LEAD_SEC;
    this.anchorCtxTime = t0;
    this.anchorPlayhead = playhead;
    for (const t of this.tracks) {
      t.source?.disconnect();
      t.source = null;
      const p = placeTrack({ playheadSec: playhead, trackStartSec: this.trackStartSec(t), durationSec: t.buffer.duration });
      if (!p) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gain);
      // All tracks share the same t0 so they start on the same sample clock tick.
      src.start(t0 + p.delaySec, p.bufferOffsetSec);
      t.source = src;
    }
  }

  private stopSources(): void {
    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.source = null;
    }
  }

  /** Reported output path latency, for comparison with the by-ear offset (M0-05). */
  get reportedLatencyMs(): { base: number; output: number } {
    return { base: this.ctx.baseLatency * 1000, output: (this.ctx.outputLatency ?? 0) * 1000 };
  }
}
