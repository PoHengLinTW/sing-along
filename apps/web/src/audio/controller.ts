import type { StoreApi } from 'zustand/vanilla';
import { type AddTrackInput, AudioEngine } from './engine';
import { adjustEdge, type LoopRegion, makeLoop } from './loop';
import { type MixerState, mixerStore } from './mixerStore';
import { type TransportState, transportStore } from './transportStore';

interface Frames {
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
}

/** Glue between the engine (Web Audio) and the transport store (what React reads). */
export class AudioController {
  private frameId: number | null = null;
  private isRecording = false;

  constructor(
    readonly engine: AudioEngine,
    private store: StoreApi<TransportState>,
    private frames: Frames = {
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
    },
    private mixer: StoreApi<MixerState> = mixerStore,
  ) {
    // Mixer edits reach the gain nodes immediately, playing or not, without restarting playback.
    this.mixer.subscribe((state, prev) => {
      for (const id of new Set(
        [...Object.keys(state.byId), ...Object.keys(prev.byId)].map(Number),
      )) {
        if (state.byId[id] !== prev.byId[id]) this.applyMix(id);
      }
    });
  }

  /** True from beginRecording to endRecording: seeking, looping and pausing are locked. */
  get recording(): boolean {
    return this.isRecording;
  }

  /** Playback continues as the backing for a take: no loop, no seeking, and the playhead may pass the end. */
  beginRecording(): void {
    this.isRecording = true;
    this.engine.setOpenEnded(true);
    this.engine.setLoop(null);
  }

  endRecording(): void {
    this.pause();
    this.isRecording = false;
    this.engine.setOpenEnded(false);
    this.applyLoop(); // the user's A–B loop applies again from the next play
  }

  private applyMix(id: number): void {
    const mix = this.mixer.getState().get(id);
    this.engine.setVolume(id, mix.volume);
    this.engine.setMuted(id, mix.muted);
    this.engine.setSolo(id, mix.solo);
  }

  addTrack(input: AddTrackInput): void {
    this.engine.addTrack(input);
    this.applyMix(input.id); // a late-loading track picks up the mix already set for it
    this.syncDuration();
  }

  removeTrack(id: number): void {
    this.engine.removeTrack(id);
    this.syncDuration();
  }

  setOffsets(id: number, offsets: { startOffsetMs?: number; latencyOffsetMs?: number }): void {
    this.engine.setOffsets(id, offsets);
    this.syncDuration();
  }

  async play(): Promise<void> {
    await this.engine.play();
    this.store.setState({ playing: true, position: this.engine.position });
    this.startLoop();
  }

  pause(): void {
    this.engine.pause();
    this.stopLoop();
    this.store.setState({ playing: false, position: this.engine.position });
  }

  async toggle(): Promise<void> {
    if (this.isRecording) return;
    if (this.engine.playing) this.pause();
    else await this.play();
  }

  seek(sec: number): void {
    if (this.isRecording) return;
    this.engine.seek(sec);
    this.store.setState({ position: this.engine.position });
  }

  /** A region made by dragging on the ruler: creates and enables the loop. False if it is too short. */
  setLoopRegion(region: LoopRegion): boolean {
    if (this.isRecording) return false;
    const valid = makeLoop(region.a, region.b);
    if (!valid) return false;
    this.store.setState({ loop: valid, loopEnabled: true, loopA: null });
    this.applyLoop();
    return true;
  }

  /**
   * "Set A" / "Set B" at the playhead. With a loop, the edge moves (B stays >= 0.5 s after A);
   * without one, A is remembered and B completes the region. False when B is rejected.
   */
  setLoopPoint(edge: 'a' | 'b'): boolean {
    if (this.isRecording) return false;
    const position = this.engine.position;
    const { loop, loopA, duration } = this.store.getState();
    if (loop) {
      this.store.setState({ loop: adjustEdge(loop, edge, position, duration) });
      this.applyLoop();
      return true;
    }
    if (edge === 'a') {
      this.store.setState({ loopA: position });
      return true;
    }
    if (loopA === null || position <= loopA) return false;
    return this.setLoopRegion({ a: loopA, b: position });
  }

  toggleLoop(): void {
    if (this.isRecording) return;
    const { loop, loopEnabled } = this.store.getState();
    if (!loop) return;
    this.store.setState({ loopEnabled: !loopEnabled });
    this.applyLoop();
  }

  clearLoop(): void {
    if (this.isRecording) return;
    this.store.setState({ loop: null, loopEnabled: false, loopA: null });
    this.applyLoop();
  }

  /** Move an edge of the existing region to `sec` (dragging its handle). */
  adjustLoopEdge(edge: 'a' | 'b', sec: number): void {
    if (this.isRecording) return;
    const { loop, duration } = this.store.getState();
    if (!loop) return;
    this.store.setState({ loop: adjustEdge(loop, edge, sec, duration) });
    this.applyLoop();
  }

  private applyLoop(): void {
    const { loop, loopEnabled } = this.store.getState();
    this.engine.setLoop(loopEnabled && loop ? loop : null);
  }

  /** Back to the start; keeps playing if it was playing (the engine restarts its sources). */
  restart(): void {
    this.seek(0);
  }

  /** Relative seek, clamped to [0, duration]. Reaching the end while playing stops on the next frame. */
  skip(deltaSec: number): void {
    this.seek(this.engine.position + deltaSec);
  }

  private syncDuration(): void {
    this.store.setState({ duration: this.engine.duration });
  }

  private startLoop(): void {
    if (this.frameId !== null) return;
    const tick = () => {
      this.frameId = null;
      const { duration } = this.store.getState();
      const position = this.engine.position;
      if (!this.isRecording && duration > 0 && position >= duration) {
        // reached the end: stop and park on the last frame
        this.engine.pause();
        this.store.setState({ playing: false, position: duration });
        return;
      }
      this.store.setState({ position });
      this.frameId = this.frames.requestFrame(tick);
    };
    this.frameId = this.frames.requestFrame(tick);
  }

  private stopLoop(): void {
    if (this.frameId !== null) this.frames.cancelFrame(this.frameId);
    this.frameId = null;
  }
}

let shared: AudioController | null = null;

/** The app-wide controller. The AudioContext inside is created lazily on first use. */
export function getAudioController(): AudioController {
  shared ??= new AudioController(new AudioEngine(), transportStore);
  return shared;
}

/** Browsers start AudioContexts suspended: resume on the first user gesture anywhere on the page. */
export function installGestureUnlock(target: Document = document): void {
  const unlock = () => {
    void getAudioController().engine.ensureContext().resume();
  };
  target.addEventListener('pointerdown', unlock, { once: true });
  target.addEventListener('keydown', unlock, { once: true });
}
