import type { StoreApi } from 'zustand/vanilla';
import { type AudioController, getAudioController } from '../controller';
import { ChunkWriter, type Draft, DraftStore } from './draftStore';
import { browserRecorderDeps, Recorder } from './recorder';
import { type RecordingState, recordingStore } from './recordingStore';
import { takePlacement } from './timing';

/** PRD cap: one take is at most 10 minutes. */
export const MAX_TAKE_SEC = 600;

type ControllerPort = Pick<AudioController, 'beginRecording' | 'endRecording' | 'play'> & {
  engine: {
    readonly playing: boolean;
    ensureContext(): { resume(): Promise<unknown> };
    timelineAt(ctxTime: number): number | null;
  };
};

type RecorderPort = Pick<Recorder, 'start' | 'stop' | 'setMuted' | 'sampleCount' | 'sampleRate'>;

export interface SessionDeps {
  controller: ControllerPort;
  getStore: () => Promise<DraftStore>;
  createRecorder: (onChunk: (samples: Float32Array) => void) => RecorderPort;
  recording: StoreApi<RecordingState>;
  maxSec?: number;
  /** Called after the take was stopped because it reached the cap. */
  onAutoStop?: (draft: Draft) => void;
}

export interface StartInput {
  projectId: number;
  deviceId: string | null;
  /** Defaults to "Take N" (N = drafts already in this project + 1). */
  name?: string;
  performer: string;
}

/**
 * One recording at a time: opens the mic, starts playback of the other tracks, stores every
 * chunk as it arrives (so a crash keeps the take) and leaves a draft for the encoder.
 */
export class RecordingSession {
  private recorder: RecorderPort | null = null;
  private writer: ChunkWriter | null = null;
  private store: DraftStore | null = null;
  private draft: Draft | null = null;
  /** Chunks that arrive before the draft record exists (the first one lands ~1 s after start). */
  private early: Float32Array[] = [];
  private stopping: Promise<Draft> | null = null;

  constructor(private deps: SessionDeps) {}

  get active(): boolean {
    return this.deps.recording.getState().status !== 'idle';
  }

  async start(input: StartInput): Promise<void> {
    const { controller, recording } = this.deps;
    if (this.active) throw new Error('Already recording');
    recording.setState({ status: 'starting', muted: false, draftId: null, startSec: 0 });
    this.early = [];
    let began = false;
    try {
      await controller.engine.ensureContext().resume();
      const recorder = this.deps.createRecorder((samples) => this.onChunk(samples));
      this.recorder = recorder;
      // Mic first, then playback: frames captured before playback starts are kept, and the
      // placement maths below puts every frame at its true timeline position.
      const { ctxTime, sampleRate } = await recorder.start(input.deviceId);
      controller.beginRecording();
      began = true;
      if (!controller.engine.playing) await controller.play();
      const startSec = controller.engine.timelineAt(ctxTime) ?? 0;
      const store = await this.deps.getStore();
      const draft = await store.createDraft({
        projectId: input.projectId,
        name: input.name ?? `Take ${(await store.listDrafts(input.projectId)).length + 1}`,
        performer: input.performer,
        sampleRate,
        ...takePlacement(startSec, sampleRate),
      });
      this.store = store;
      this.draft = draft;
      this.writer = new ChunkWriter(store, draft.id);
      for (const c of this.early) this.writer.push(c);
      this.early = [];
      recording.setState({ status: 'recording', draftId: draft.id, startSec });
    } catch (err) {
      await this.abort(began);
      throw err;
    }
  }

  setMuted(muted: boolean): void {
    this.recorder?.setMuted(muted);
    this.deps.recording.setState({ muted });
  }

  /** Ends the take: playback pauses at once, then the audio is flushed and the draft handed to the encoder. */
  stop(): Promise<Draft> {
    if (this.stopping) return this.stopping;
    if (this.deps.recording.getState().status !== 'recording' || !this.recorder || !this.draft) {
      return Promise.reject(new Error('Not recording'));
    }
    this.stopping = this.finish(this.recorder, this.draft).finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  /** For leaving the page: stops a running take, does nothing otherwise. */
  stopIfRecording(): void {
    if (this.deps.recording.getState().status === 'recording') void this.stop().catch(() => {});
  }

  private async finish(recorder: RecorderPort, draft: Draft): Promise<Draft> {
    const { controller, recording } = this.deps;
    recording.setState({ status: 'stopping' });
    controller.endRecording();
    try {
      await recorder.stop();
      await this.writer?.close();
      return await (this.store as DraftStore).updateDraft(draft.id, { status: 'encoding' });
    } finally {
      this.reset();
    }
  }

  private onChunk(samples: Float32Array): void {
    if (this.writer) this.writer.push(samples);
    else this.early.push(samples);
    const rec = this.recorder;
    const max = this.deps.maxSec ?? MAX_TAKE_SEC;
    if (
      rec &&
      rec.sampleRate > 0 &&
      rec.sampleCount / rec.sampleRate >= max &&
      this.deps.recording.getState().status === 'recording'
    ) {
      void this.stop()
        .then((d) => this.deps.onAutoStop?.(d))
        .catch(() => {});
    }
  }

  private async abort(began: boolean): Promise<void> {
    if (began) this.deps.controller.endRecording();
    try {
      await this.recorder?.stop();
      await this.writer?.close();
    } catch {
      // Best effort: the original error is what the caller needs to see.
    }
    this.reset();
  }

  private reset(): void {
    this.recorder = null;
    this.writer = null;
    this.draft = null;
    this.store = null;
    this.early = [];
    this.deps.recording.setState({ status: 'idle', muted: false, draftId: null, startSec: 0 });
  }
}

let storePromise: Promise<DraftStore> | null = null;
export const getDraftStore = () => {
  storePromise ??= DraftStore.open();
  return storePromise;
};

let shared: RecordingSession | null = null;

/** The app-wide session, wired to the shared audio controller and the browser's mic. */
export function getRecordingSession(): RecordingSession {
  shared ??= new RecordingSession({
    controller: getAudioController(),
    getStore: getDraftStore,
    createRecorder: (onChunk) => {
      const ctx = getAudioController().engine.ensureContext();
      return new Recorder(browserRecorderDeps(ctx), onChunk);
    },
    recording: recordingStore,
    onAutoStop: () => {
      // The UI layer shows the toast (RecordButton subscribes via setAutoStopHandler).
      autoStopHandler?.();
    },
  });
  return shared;
}

let autoStopHandler: (() => void) | null = null;
export function setAutoStopHandler(fn: (() => void) | null): void {
  autoStopHandler = fn;
}
