import {
  firstSegmentEnd,
  type LoopRegion,
  nextSegmentStart,
  positionAt,
  type Segment,
} from './loop';
import { audibleGain, projectDuration, trackStartSec } from './schedule';

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
  /** Every source scheduled for this track: the current pass and any pass scheduled ahead. */
  sources: AudioBufferSourceNode[];
}

export interface Timers {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
}

/** Start lead: all sources of one (re)start are scheduled this far ahead so they share one clock tick. */
const START_LEAD_SEC = 0.1;
/** Gain smoothing: 5 time constants (99%) = 50 ms, so mixer changes are audible within the 50 ms budget, click-free. */
const GAIN_TIME_CONSTANT_SEC = 0.01;
/** The next loop pass is scheduled once it is this close, so the wrap is sample-accurate. */
const LOOKAHEAD_SEC = 0.25;
const PUMP_INTERVAL_MS = 40;
/** Keep a few finished passes so positionAt() still finds the current one. */
const KEEP_PAST_SEC = 1;

const realTimers: Timers = {
  set: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clear: (id) => clearInterval(id),
};

/**
 * Web Audio playback: one AudioBufferSourceNode + GainNode per track, all scheduled on the
 * AudioContext clock (never Date.now). The timeline is played as "segments": a stretch of
 * project time that starts at an AudioContext time. Without a loop there is one open-ended
 * segment; with an A-B loop the passes are scheduled ahead of time, back to back, so the wrap
 * has no gap. The context is created lazily and resumed in play() (a user gesture).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private tracks = new Map<number, TrackState>();
  private owners = new WeakMap<object, number>();
  private segments: Segment[] = [];
  private pausedPlayhead = 0;
  private loop: LoopRegion | null = null;
  private timerId: number | null = null;
  playing = false;

  constructor(
    private createContext: () => AudioContext = () => new AudioContext(),
    private timers: Timers = realTimers,
  ) {}

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
    return Math.min(positionAt(this.segments, this.ensureContext().currentTime), this.duration);
  }

  addTrack(input: AddTrackInput): void {
    const ctx = this.ensureContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const track: TrackState = { ...input, volume: 1, muted: false, solo: false, gain, sources: [] };
    this.tracks.set(input.id, track);
    this.applyGains();
    if (this.playing) this.scheduleTrackNow(track);
  }

  removeTrack(id: number): void {
    const track = this.tracks.get(id);
    if (!track) return;
    this.stopSources(track);
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
    this.syncTimer();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedPlayhead = this.position;
    this.stopAll();
    this.segments = [];
    this.playing = false;
    this.syncTimer();
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

  /** null turns looping off. While playing, playback continues from the current position. */
  setLoop(region: LoopRegion | null): void {
    this.loop = region;
    if (this.playing) {
      // Hand over seamlessly: the old passes end exactly when the new ones begin, at the
      // position playback will have reached by then (no jump, no gap).
      const t0 = this.ensureContext().currentTime + START_LEAD_SEC;
      const here = positionAt(this.segments, t0);
      this.stopAll(t0);
      this.segments = [];
      this.pushSegment({ ctxStart: t0, from: here, to: firstSegmentEnd(here, this.loop) });
    }
    this.syncTimer();
  }

  /** Schedules loop passes that are about to begin. Called by a short timer; idempotent. */
  pump(): void {
    const loop = this.loop;
    if (!this.playing || !loop) return;
    const now = this.ensureContext().currentTime;
    let last = this.segments.at(-1);
    while (last && Number.isFinite(last.to) && nextSegmentStart(last) - now <= LOOKAHEAD_SEC) {
      const next: Segment = { ctxStart: nextSegmentStart(last), from: loop.a, to: loop.b };
      this.pushSegment(next);
      last = next;
    }
    this.segments = this.segments.filter(
      (s, i, all) => i >= all.length - 2 || nextSegmentStart(s) > now - KEEP_PAST_SEC,
    );
  }

  /** Reschedules only the affected track when playing; otherwise the next play() picks it up. */
  setOffsets(id: number, offsets: { startOffsetMs?: number; latencyOffsetMs?: number }): void {
    const track = this.tracks.get(id);
    if (!track) return;
    if (offsets.startOffsetMs !== undefined) track.startOffsetMs = offsets.startOffsetMs;
    if (offsets.latencyOffsetMs !== undefined) track.latencyOffsetMs = offsets.latencyOffsetMs;
    if (this.playing) {
      this.stopSources(track);
      this.scheduleTrackNow(track);
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
    const t0 = this.ensureContext().currentTime + START_LEAD_SEC;
    this.segments = [];
    // Before B the loop applies (play on to B, then wrap); at or past B it is ignored.
    this.pushSegment({ ctxStart: t0, from: playhead, to: firstSegmentEnd(playhead, this.loop) });
  }

  private pushSegment(seg: Segment): void {
    this.segments.push(seg);
    for (const track of this.tracks.values())
      this.scheduleTrackSegment(track, seg, seg.from, seg.ctxStart);
  }

  /**
   * Adds one track to a running playback: into the pass in progress (from where the playhead
   * will be one lead from now) and into every pass already scheduled after it.
   */
  private scheduleTrackNow(track: TrackState): void {
    const t0 = this.ensureContext().currentTime + START_LEAD_SEC;
    const playheadAtT0 = positionAt(this.segments, t0);
    for (const seg of this.segments) {
      const end = seg.ctxStart + (seg.to - seg.from);
      if (end <= t0) continue; // already finished
      if (seg.ctxStart <= t0) this.scheduleTrackSegment(track, seg, playheadAtT0, t0);
      else this.scheduleTrackSegment(track, seg, seg.from, seg.ctxStart);
    }
  }

  /** Sources for the part of `seg` from timeline `fromSec` (starting at ctx `atCtx`) that this track covers. */
  private scheduleTrackSegment(
    track: TrackState,
    seg: Segment,
    fromSec: number,
    atCtx: number,
  ): void {
    const trackStart = trackStartSec(track);
    const trackEnd = trackStart + track.buffer.duration;
    const startTimeline = Math.max(fromSec, trackStart);
    const endTimeline = Math.min(seg.to, trackEnd);
    if (startTimeline >= endTimeline) return; // the track is silent in this stretch

    const src = this.ensureContext().createBufferSource();
    src.buffer = track.buffer;
    src.connect(track.gain);
    const when = atCtx + (startTimeline - fromSec);
    const offset = startTimeline - trackStart;
    // A bounded pass stops itself at B; an open-ended one plays to the end of the buffer.
    if (Number.isFinite(seg.to)) src.start(when, offset, endTimeline - startTimeline);
    else src.start(when, offset);
    this.owners.set(src, track.id);
    track.sources.push(src);
  }

  private syncTimer(): void {
    const shouldRun = this.playing && this.loop !== null;
    if (shouldRun && this.timerId === null) {
      this.timerId = this.timers.set(() => this.pump(), PUMP_INTERVAL_MS);
    } else if (!shouldRun && this.timerId !== null) {
      this.timers.clear(this.timerId);
      this.timerId = null;
    }
  }

  private stopAll(at?: number): void {
    for (const t of this.tracks.values()) this.stopSources(t, at);
  }

  /** Stops now, or at AudioContext time `at` (then disconnects once it has actually ended). */
  private stopSources(track: TrackState, at?: number): void {
    for (const src of track.sources) {
      try {
        src.stop(at);
      } catch {
        /* already stopped */
      }
      if (at === undefined) src.disconnect();
      else src.onended = () => src.disconnect();
    }
    track.sources = [];
  }
}
