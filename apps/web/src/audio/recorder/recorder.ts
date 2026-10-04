import { type MicSource, openMic } from './mic';
import workletUrl from './recorder.worklet.ts?worker&url';

/** What the Recorder needs from the browser: injected so the message handling is testable. */
export interface RecorderDeps {
  addModule(): Promise<void>;
  openStream(deviceId: string | null): Promise<{ stream: MediaStream; deviceId: string | null }>;
  connect(stream: MediaStream): { port: MessagePort; disconnect(): void };
}

export function browserRecorderDeps(
  ctx: AudioContext,
  media: MicSource = navigator.mediaDevices,
): RecorderDeps {
  return {
    addModule: () => ctx.audioWorklet.addModule(workletUrl),
    openStream: (deviceId) => openMic(media, deviceId),
    connect: (stream) => {
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      // Some browsers only pull a worklet that reaches the destination: use a silent sink.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(node).connect(sink).connect(ctx.destination);
      return {
        port: node.port,
        disconnect: () => {
          src.disconnect();
          node.disconnect();
          sink.disconnect();
        },
      };
    },
  };
}

export interface RecorderResult {
  sampleCount: number;
  sampleRate: number;
}

export interface LevelMessage {
  min: number;
  max: number;
  frames: number;
  /** True for blocks inside the take (as opposed to input-check monitoring). */
  capturing: boolean;
}

/**
 * Mono AudioWorklet capture on the playback AudioContext, so take timing shares the playback clock.
 * `open` connects the mic and reports levels (input check); `startCapture` then begins the take.
 * Chunks are handed to `onChunk` (which persists them) and are not kept in memory here.
 */
export class Recorder {
  /** Sample rate of the AudioContext, known once capture has started; stored with the take. */
  sampleRate = 0;
  sampleCount = 0;
  muted = false;
  private link: { port: MessagePort; disconnect(): void } | null = null;
  private stream: MediaStream | null = null;
  private chunkIndex = 0;
  private firstFrame: Promise<{ ctxTime: number; sampleRate: number }> | null = null;

  constructor(
    private deps: RecorderDeps,
    private onChunk: (samples: Float32Array, index: number) => void = () => {},
    private onLevel: (level: LevelMessage) => void = () => {},
  ) {}

  /** Connects the mic. Levels flow from now on; nothing is captured until `startCapture`. */
  async open(deviceId: string | null): Promise<void> {
    await this.deps.addModule();
    const { stream } = await this.deps.openStream(deviceId);
    this.stream = stream;
    try {
      this.link = this.deps.connect(stream);
    } catch (err) {
      this.release();
      throw err;
    }
    let onFirst: (v: { ctxTime: number; sampleRate: number }) => void = () => {};
    this.firstFrame = new Promise((resolve) => {
      onFirst = resolve;
    });
    this.link.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'start') {
        this.sampleRate = m.sampleRate;
        onFirst({ ctxTime: m.ctxTime, sampleRate: m.sampleRate });
      } else if (m.type === 'chunk') {
        this.sampleCount += m.samples.length;
        this.onChunk(m.samples, this.chunkIndex++);
      } else if (m.type === 'level') {
        this.onLevel({ min: m.min, max: m.max, frames: m.frames, capturing: m.capturing });
      }
    };
  }

  /** Begins the take. Resolves when the first audio arrives, with the context time of its first frame. */
  startCapture(): Promise<{ ctxTime: number; sampleRate: number }> {
    if (!this.link || !this.firstFrame) return Promise.reject(new Error('Microphone not open'));
    this.link.port.postMessage({ type: 'capture', on: true });
    return this.firstFrame;
  }

  async start(deviceId: string | null): Promise<{ ctxTime: number; sampleRate: number }> {
    await this.open(deviceId);
    return this.startCapture();
  }

  /** Pauses or continues the take's capture; the mic and the meter stay on. */
  setCapturing(on: boolean): void {
    this.link?.port.postMessage({ type: 'capture', on });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.link?.port.postMessage({ type: 'mute', muted });
  }

  async stop(): Promise<RecorderResult> {
    const link = this.link;
    if (link) {
      const done = new Promise<void>((resolve) => {
        const prev = link.port.onmessage;
        link.port.onmessage = (e: MessageEvent) =>
          e.data.type === 'done' ? resolve() : prev?.call(link.port, e);
      });
      link.port.postMessage('stop');
      await done;
    }
    this.release();
    return { sampleCount: this.sampleCount, sampleRate: this.sampleRate };
  }

  /** Releases the mic without a take (input check off). */
  close(): void {
    this.release();
  }

  private release(): void {
    this.link?.disconnect();
    this.link = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }
}
