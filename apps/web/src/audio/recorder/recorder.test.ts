import { describe, expect, it, vi } from 'vitest';
import { Recorder, type RecorderDeps } from './recorder';

class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  postMessage(m: unknown) {
    this.sent.push(m);
    if (m === 'stop') queueMicrotask(() => this.emit({ type: 'done' }));
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}

function setup() {
  const port = new FakePort();
  const stopTrack = vi.fn();
  const disconnect = vi.fn();
  const deps: RecorderDeps = {
    addModule: vi.fn(async () => {}),
    openStream: vi.fn(async () => ({
      stream: { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream,
      deviceId: null,
    })),
    connect: vi.fn(() => ({ port: port as unknown as MessagePort, disconnect })),
  };
  return { port, deps, stopTrack, disconnect };
}

describe('Recorder', () => {
  it('start resolves with the first frame time and sample rate, and stores the rate', async () => {
    const { port, deps } = setup();
    const rec = new Recorder(deps);
    const p = rec.start(null);
    await vi.waitFor(() => expect(port.onmessage).not.toBeNull());
    port.emit({ type: 'start', ctxTime: 1.25, sampleRate: 48000 });
    expect(await p).toEqual({ ctxTime: 1.25, sampleRate: 48000 });
    expect(rec.sampleRate).toBe(48000);
  });

  it('forwards chunks with an index and counts samples', async () => {
    const { port, deps } = setup();
    const onChunk = vi.fn();
    const rec = new Recorder(deps, onChunk);
    const p = rec.start(null);
    await vi.waitFor(() => expect(port.onmessage).not.toBeNull());
    port.emit({ type: 'start', ctxTime: 0, sampleRate: 48000 });
    await p;
    port.emit({ type: 'chunk', samples: new Float32Array(100) });
    port.emit({ type: 'chunk', samples: new Float32Array(50) });
    expect(onChunk.mock.calls.map((c) => c[1])).toEqual([0, 1]);
    expect(rec.sampleCount).toBe(150);
  });

  it('stop flushes, waits for done, releases the mic and reports the totals', async () => {
    const { port, deps, stopTrack, disconnect } = setup();
    const rec = new Recorder(deps);
    const p = rec.start(null);
    await vi.waitFor(() => expect(port.onmessage).not.toBeNull());
    port.emit({ type: 'start', ctxTime: 0, sampleRate: 44100 });
    await p;
    port.emit({ type: 'chunk', samples: new Float32Array(10) });
    const r = await rec.stop();
    expect(port.sent).toContain('stop');
    expect(stopTrack).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(r).toEqual({ sampleCount: 10, sampleRate: 44100 });
  });

  it('setMuted posts the flag to the worklet', async () => {
    const { port, deps } = setup();
    const rec = new Recorder(deps);
    void rec.start(null);
    await vi.waitFor(() => expect(port.onmessage).not.toBeNull());
    rec.setMuted(true);
    expect(port.sent).toContainEqual({ type: 'mute', muted: true });
    expect(rec.muted).toBe(true);
  });

  it('releases the mic if starting fails after the stream opened', async () => {
    const { deps, stopTrack } = setup();
    deps.connect = vi.fn(() => {
      throw new Error('boom');
    });
    const rec = new Recorder(deps);
    await expect(rec.start(null)).rejects.toThrow('boom');
    expect(stopTrack).toHaveBeenCalled();
  });
});

describe('Recorder monitor mode (input check)', () => {
  it('open connects the mic without capturing, and forwards levels', async () => {
    const { port, deps } = setup();
    const onLevel = vi.fn();
    const rec = new Recorder(deps, undefined, onLevel);
    await rec.open(null);
    expect(port.sent).not.toContainEqual({ type: 'capture', on: true });
    port.emit({ type: 'level', min: -0.5, max: 0.25, frames: 1024, capturing: false });
    expect(onLevel).toHaveBeenCalledWith({ min: -0.5, max: 0.25, frames: 1024, capturing: false });
  });

  it('close releases the mic without asking the worklet to stop', async () => {
    const { port, deps, stopTrack, disconnect } = setup();
    const rec = new Recorder(deps);
    await rec.open(null);
    rec.close();
    expect(stopTrack).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(port.sent).not.toContain('stop');
  });

  it('startCapture turns capture on and resolves with the first captured frame', async () => {
    const { port, deps } = setup();
    const rec = new Recorder(deps);
    await rec.open(null);
    const p = rec.startCapture();
    expect(port.sent).toContainEqual({ type: 'capture', on: true });
    port.emit({ type: 'start', ctxTime: 3.5, sampleRate: 44100 });
    expect(await p).toEqual({ ctxTime: 3.5, sampleRate: 44100 });
    expect(rec.sampleRate).toBe(44100);
  });

  it('marks levels that arrive while capturing', async () => {
    const { port, deps } = setup();
    const onLevel = vi.fn();
    const rec = new Recorder(deps, undefined, onLevel);
    void rec.start(null);
    await vi.waitFor(() => expect(port.onmessage).not.toBeNull());
    port.emit({ type: 'level', min: 0, max: 1, frames: 1024, capturing: true });
    expect(onLevel.mock.calls[0]?.[0].capturing).toBe(true);
  });
});
