import { audibleGain, planStart, projectDuration } from './schedule';

export interface AddTrackInput {
  id: number;
  buffer: AudioBuffer;
  startOffsetMs: number;
  latencyOffsetMs: number;
}

interface TrackState extends AddTrackInput {
  volume: number;
  muted: boolean;
  solo: boolean;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

/** Start lead: all sources of one (re)start are scheduled this far ahead so they share one clock tick. */
const START_LEAD_SEC = 0.1;
/** Gain smoothing: 5 time constants (99%) = 50 ms, so mixer changes are audible within the 50 ms budget, click-free. */
const GAIN_TIME_CONSTANT_SEC = 0.01;

/**
 * Web Audio playback: one AudioBufferSourceNode + GainNode per track, all scheduled on the
 * AudioContext clock (never Date.now). The context is created lazily and resumed on play(),
 * which is called from a user gesture.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private tracks = new Map<number, TrackState>();
  private owners = new WeakMap<object, number>();
  private anchorCtxTime = 0;
  private anchorPlayhead = 0;
  private pausedPlayhead = 0;
  playing = false;

  constructor(private createContext: () => AudioContext = () => new AudioContext()) {}

  ensureContext(): AudioContext {
    this.ctx ??= this.createContext();
    return this.ctx;
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ensureContext().decodeAudioData(data);
  }

  get duration(): number {
    return projectDuration(this.scheduleTracks());
  }

  get position(): number {
    if (!this.playing) return this.pausedPlayhead;
    // During the start lead the clock is before the anchor: hold at the anchor, never go backwards.
    const elapsed = Math.max(0, this.ensureContext().currentTime - this.anchorCtxTime);
    return Math.min(this.anchorPlayhead + elapsed, this.duration);
  }

  addTrack(input: AddTrackInput): void {
    const ctx = this.ensureContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const track: TrackState = {
      ...input,
      volume: 1,
      muted: false,
      solo: false,
      gain,
      source: null,
    };
    this.tracks.set(input.id, track);
    this.applyGains();
    if (this.playing) this.startTrackNow(track);
  }

  removeTrack(id: number): void {
    const track = this.tracks.get(id);
    if (!track) return;
    this.stopSource(track);
    track.gain.disconnect();
    this.tracks.delete(id);
    this.applyGains(); // removing the only soloed track ends solo mode
  }

  async play(): Promise<void> {
    if (this.playing) return;
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') await ctx.resume();
    this.startAll(this.pausedPlayhead);
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedPlayhead = this.position;
    this.stopAll();
    this.playing = false;
  }

  seek(sec: number): void {
    const target = Math.min(Math.max(0, sec), this.duration);
    if (this.playing) {
      this.stopAll();
      this.startAll(target);
    } else {
      this.pausedPlayhead = target;
    }
  }

  /** Reschedules only the affected track when playing; otherwise the next play() picks it up. */
  setOffsets(id: number, offsets: { startOffsetMs?: number; latencyOffsetMs?: number }): void {
    const track = this.tracks.get(id);
    if (!track) return;
    if (offsets.startOffsetMs !== undefined) track.startOffsetMs = offsets.startOffsetMs;
    if (offsets.latencyOffsetMs !== undefined) track.latencyOffsetMs = offsets.latencyOffsetMs;
    if (this.playing) {
      this.stopSource(track);
      this.startTrackNow(track);
    }
  }

  setVolume(id: number, volume: number): void {
    this.mutate(id, (t) => {
      t.volume = volume;
    });
  }
  setMuted(id: number, muted: boolean): void {
    this.mutate(id, (t) => {
      t.muted = muted;
    });
  }
  setSolo(id: number, solo: boolean): void {
    this.mutate(id, (t) => {
      t.solo = solo;
    });
  }

  /** Test helper: which track owns a source node. */
  debugTrackOfSource(source: object): number | undefined {
    return this.owners.get(source);
  }

  private mutate(id: number, fn: (t: TrackState) => void): void {
    const t = this.tracks.get(id);
    if (!t) return;
    fn(t);
    this.applyGains();
  }

  private applyGains(): void {
    const ctx = this.ensureContext();
    const list = [...this.tracks.values()];
    const anySolo = list.some((t) => t.solo);
    for (const t of list) {
      t.gain.gain.setTargetAtTime(audibleGain(t, anySolo), ctx.currentTime, GAIN_TIME_CONSTANT_SEC);
    }
  }

  private scheduleTracks() {
    return [...this.tracks.values()].map((t) => ({
      id: t.id,
      durationSec: t.buffer.duration,
      startOffsetMs: t.startOffsetMs,
      latencyOffsetMs: t.latencyOffsetMs,
    }));
  }

  private startAll(playhead: number): void {
    const ctx = this.ensureContext();
    const t0 = ctx.currentTime + START_LEAD_SEC;
    this.anchorCtxTime = t0;
    this.anchorPlayhead = playhead;
    for (const plan of planStart(playhead, this.scheduleTracks())) {
      const track = this.tracks.get(plan.id);
      if (track) this.startSource(track, t0 + plan.delaySec, plan.bufferOffsetSec);
    }
  }

  /** Starts one track on the running clock: the playhead at (now + lead) decides where in the buffer it begins. */
  private startTrackNow(track: TrackState): void {
    const ctx = this.ensureContext();
    const t0 = ctx.currentTime + START_LEAD_SEC;
    const playheadAtT0 = this.anchorPlayhead + (t0 - this.anchorCtxTime);
    const [plan] = planStart(playheadAtT0, [
      {
        id: track.id,
        durationSec: track.buffer.duration,
        startOffsetMs: track.startOffsetMs,
        latencyOffsetMs: track.latencyOffsetMs,
      },
    ]);
    if (plan) this.startSource(track, t0 + plan.delaySec, plan.bufferOffsetSec);
  }

  private startSource(track: TrackState, when: number, bufferOffsetSec: number): void {
    const src = this.ensureContext().createBufferSource();
    src.buffer = track.buffer;
    src.connect(track.gain);
    src.start(when, bufferOffsetSec);
    this.owners.set(src, track.id);
    track.source = src;
  }

  private stopAll(): void {
    for (const t of this.tracks.values()) this.stopSource(t);
  }

  private stopSource(track: TrackState): void {
    const src = track.source;
    if (!src) return;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    src.disconnect();
    track.source = null;
  }
}
