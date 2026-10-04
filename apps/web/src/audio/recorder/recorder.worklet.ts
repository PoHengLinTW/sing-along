// Runs in the AudioWorkletGlobalScope. Always reports input levels (min/max blocks); while
// capturing it also reports the context time of the first frame (for offset math) and streams
// ~1 s chunks. Mute zeroes the take's samples but keeps its length.
import { ChunkBatcher } from './chunker';
import { LevelTracker } from './level';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class RecorderProcessor extends AudioWorkletProcessor {
  private batcher = new ChunkBatcher(sampleRate);
  private levels = new LevelTracker();
  private capturing = false;
  private first = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m === 'stop') {
        this.capturing = false;
        this.emit([this.batcher.flush()]);
        this.port.postMessage({ type: 'done' });
      } else if (m?.type === 'capture') {
        const on = m.on === true;
        if (!on && this.capturing) this.emit([this.batcher.flush()]); // a pause closes the chunk
        this.capturing = on;
      } else if (m?.type === 'mute') this.batcher.setMuted(m.muted === true);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (const b of this.levels.push(ch)) {
      this.port.postMessage({ type: 'level', ...b, capturing: this.capturing });
    }
    if (!this.capturing) return true;
    if (this.first) {
      this.first = false;
      this.port.postMessage({ type: 'start', ctxTime: currentTime, sampleRate });
    }
    this.emit(this.batcher.push(ch));
    return true;
  }

  private emit(chunks: (Float32Array | null)[]): void {
    for (const c of chunks) if (c) this.port.postMessage({ type: 'chunk', samples: c }, [c.buffer]);
  }
}
registerProcessor('recorder', RecorderProcessor as never);
