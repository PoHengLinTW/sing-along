// Runs in the AudioWorkletGlobalScope. Batches 128-frame quanta into ~4096-frame chunks
// (fewer messages) and reports the context time of the first frame for offset math.
declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const CHUNK = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK);
  private filled = 0;
  private first = true;
  private nextFrame = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'stop') {
        if (!this.first) this.padToFrame(currentFrame);
        this.flush();
        this.port.postMessage({ type: 'done' });
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    if (this.first) {
      this.first = false;
      this.nextFrame = currentFrame;
      this.port.postMessage({ type: 'start', ctxTime: currentTime, sampleRate });
    }
    this.padToFrame(currentFrame);
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(CHUNK - this.filled, ch.length - i);
      this.buf.set(ch.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      this.nextFrame += n;
      if (this.filled === CHUNK) this.flush();
    }
    return true;
  }

  private padToFrame(frame: number): void {
    while (this.nextFrame < frame) {
      const n = Math.min(CHUNK - this.filled, frame - this.nextFrame);
      this.buf.fill(0, this.filled, this.filled + n);
      this.filled += n;
      this.nextFrame += n;
      if (this.filled === CHUNK) this.flush();
    }
  }

  private flush(): void {
    if (this.filled === 0) return;
    const out = this.buf.slice(0, this.filled);
    this.port.postMessage({ type: 'chunk', samples: out }, [out.buffer]);
    this.filled = 0;
  }
}
registerProcessor('recorder', RecorderProcessor as never);
export {};
