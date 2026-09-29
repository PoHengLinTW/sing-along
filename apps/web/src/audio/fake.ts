/** Minimal AudioContext stand-in for tests: records scheduling and lets tests move the clock. */
export class FakeParam {
  value = 1;
  targets: { value: number; time: number; timeConstant: number }[] = [];
  setTargetAtTime(value: number, time: number, timeConstant: number) {
    this.targets.push({ value, time, timeConstant });
    this.value = value;
  }
}
export class FakeGain {
  gain = new FakeParam();
  connected: unknown = null;
  connect(node: unknown) {
    this.connected = node;
  }
  disconnect() {
    this.connected = null;
  }
}
export class FakeSource {
  buffer: FakeBuffer | null = null;
  starts: { when: number; offset: number }[] = [];
  stopped = false;
  connected: unknown = null;
  connect(node: unknown) {
    this.connected = node;
  }
  disconnect() {
    this.connected = null;
  }
  start(when: number, offset: number) {
    this.starts.push({ when, offset });
  }
  stop() {
    this.stopped = true;
  }
}
export class FakeBuffer {
  constructor(public duration: number) {}
}
export class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' = 'suspended';
  destination = { kind: 'destination' };
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resumeCalls = 0;
  async resume() {
    this.resumeCalls++;
    this.state = 'running';
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}
