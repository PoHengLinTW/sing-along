// Runs in the AudioWorkletGlobalScope. Batches 128-frame quanta into ~4096-frame chunks
// (fewer messages) and reports the context time of the first frame for offset math.
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const CHUNK = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK);
  private filled = 0;
  private first = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'stop') {
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
      this.port.postMessage({ type: 'start', ctxTime: currentTime, sampleRate });
    }
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(CHUNK - this.filled, ch.length - i);
      this.buf.set(ch.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === CHUNK) this.flush();
    }
    return true;
  }

  private flush(): void {
    if (this.filled === 0) return;
    const out = this.buf.slice(0, this.filled);
    this.port.postMessage({ type: 'chunk', samples: out }, [out.buffer]);
    this.filled = 0;
  }
}
registerProcessor('recorder', RecorderProcessor as never);
