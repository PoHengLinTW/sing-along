import workletUrl from './recorder.worklet.ts?worker&url';
import { RAW_MIC_CONSTRAINTS } from '../mic';
import { concatChunks, type Take } from './take';

export interface RecorderHooks {
  /** Called for every PCM chunk as it arrives (M0-06 persists these). */
  onChunk?: (samples: Float32Array, index: number) => void;
}

/** Mono AudioWorklet capture on an existing AudioContext, so timing shares the playback clock. */
export class Recorder {
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private firstCtxTime = 0;
  private sampleRate = 0;
  settings: MediaTrackSettings = {};
  /** Timeline position (sec) of the first captured frame; set by the caller from the engine. */
  startSec = 0;

  constructor(private ctx: AudioContext, private hooks: RecorderHooks = {}) {}

  /** Resolves once the first audio quantum arrives, with its AudioContext time. */
  async start(deviceId?: string): Promise<number> {
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...RAW_MIC_CONSTRAINTS, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
    });
    this.settings = this.stream.getAudioTracks()[0].getSettings();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    // Some browsers only pull a worklet that reaches the destination; use a silent sink.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    src.connect(this.node).connect(sink).connect(this.ctx.destination);
    this.chunks = [];
    return new Promise((resolve) => {
      this.node!.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'start') {
          this.firstCtxTime = m.ctxTime;
          this.sampleRate = m.sampleRate;
          resolve(m.ctxTime);
        } else if (m.type === 'chunk') {
          this.hooks.onChunk?.(m.samples, this.chunks.length);
          this.chunks.push(m.samples);
        }
      };
    });
  }

  get firstFrameCtxTime(): number {
    return this.firstCtxTime;
  }

  async stop(startOffsetMs: number): Promise<Take> {
    const node = this.node!;
    const done = new Promise<void>((res) => {
      const prev = node.port.onmessage!;
      node.port.onmessage = (e) => (e.data.type === 'done' ? res() : prev.call(node.port, e));
    });
    node.port.postMessage('stop');
    await done;
    node.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    return { samples: concatChunks(this.chunks), sampleRate: this.sampleRate, startOffsetMs };
  }
}
