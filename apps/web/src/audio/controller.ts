import type { StoreApi } from 'zustand/vanilla';
import { type AddTrackInput, AudioEngine } from './engine';
import { type TransportState, transportStore } from './transportStore';

interface Frames {
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
}

/** Glue between the engine (Web Audio) and the transport store (what React reads). */
export class AudioController {
  private frameId: number | null = null;

  constructor(
    readonly engine: AudioEngine,
    private store: StoreApi<TransportState>,
    private frames: Frames = {
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
    },
  ) {}

  addTrack(input: AddTrackInput): void {
    this.engine.addTrack(input);
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
    if (this.engine.playing) this.pause();
    else await this.play();
  }

  seek(sec: number): void {
    this.engine.seek(sec);
    this.store.setState({ position: this.engine.position });
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
      if (duration > 0 && position >= duration) {
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
