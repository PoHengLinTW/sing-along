import { afterEach, describe, expect, it, vi } from 'vitest';

type Worklet = {
  port: { onmessage: (event: { data: unknown }) => void };
  process: (inputs: Float32Array[][]) => boolean;
};

async function makeWorklet() {
  const messages: { type: string; samples?: Float32Array }[] = [];
  let Processor: new () => Worklet;
  Object.assign(globalThis, {
    sampleRate: 48000,
    currentFrame: 0,
    currentTime: 0,
    AudioWorkletProcessor: class {
      port = { onmessage: (_event: { data: unknown }) => {}, postMessage: (message: { type: string; samples?: Float32Array }) => messages.push(message) };
    },
    registerProcessor: (_name: string, ctor: new () => Worklet) => { Processor = ctor; },
  });
  vi.resetModules();
  await import('./recorder.worklet');
  return { worklet: new Processor!(), messages };
}

afterEach(() => {
  for (const name of ['sampleRate', 'currentFrame', 'currentTime', 'AudioWorkletProcessor', 'registerProcessor']) {
    Reflect.deleteProperty(globalThis, name);
  }
});

describe('recorder worklet', () => {
  it('preserves timeline length by filling missing input quanta with silence', async () => {
    const { worklet, messages } = await makeWorklet();
    worklet.process([[new Float32Array(128).fill(0.25)]]);
    Object.assign(globalThis, { currentFrame: 128, currentTime: 128 / 48000 });
    worklet.process([[]]);
    Object.assign(globalThis, { currentFrame: 256, currentTime: 256 / 48000 });
    worklet.process([[new Float32Array(128).fill(0.5)]]);
    Object.assign(globalThis, { currentFrame: 384, currentTime: 384 / 48000 });
    worklet.port.onmessage({ data: 'stop' });

    const pcm = messages.filter((message) => message.type === 'chunk').flatMap((message) => Array.from(message.samples!));
    expect(pcm).toHaveLength(384);
    expect(pcm.slice(0, 128)).toEqual(Array(128).fill(0.25));
    expect(pcm.slice(128, 256)).toEqual(Array(128).fill(0));
    expect(pcm.slice(256)).toEqual(Array(128).fill(0.5));
  });
});
