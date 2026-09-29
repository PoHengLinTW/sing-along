import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveWave } from '../audio/recorder/liveWave';
import { RecordingLane } from './RecordingLane';

const fillRect = vi.fn();
const ctx2d = {
  clearRect: vi.fn(),
  fillRect,
  scale: vi.fn(),
  setTransform: vi.fn(),
  fillStyle: '',
};
let frames: FrameRequestCallback[];

beforeEach(() => {
  fillRect.mockClear();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
});
afterEach(() => vi.unstubAllGlobals());

const runFrame = () =>
  act(() => {
    for (const f of frames.splice(0)) f(0);
  });

function setup(wave: LiveWave, pxPerSec = 10, scrollLeft = 0) {
  const scroller = document.createElement('div');
  Object.defineProperty(scroller, 'clientWidth', { value: 200 });
  Object.defineProperty(scroller, 'scrollLeft', { value: scrollLeft });
  const view = render(
    <RecordingLane
      wave={wave}
      pxPerSec={pxPerSec}
      scroller={{ current: scroller }}
      height={100}
      color="#f00"
    />,
  );
  return { scroller, ...view };
}

describe('RecordingLane', () => {
  it('draws the captured blocks at the take start, in step with the timeline', () => {
    const wave = new LiveWave();
    wave.setTiming(2, 1000, 500); // starts at 2 s = x 20 at 10 px/s; 0.5 s blocks = 5 px
    setup(wave);
    act(() => wave.push(-0.5, 0.5));
    runFrame();
    const xs = fillRect.mock.calls.map((c) => c[0]);
    expect(xs).toEqual([20, 21, 22, 23, 24]);
  });

  it('offsets by the scroll position', () => {
    const wave = new LiveWave();
    wave.setTiming(2, 1000, 500);
    setup(wave, 10, 10);
    act(() => wave.push(-0.5, 0.5));
    runFrame();
    expect(fillRect.mock.calls[0]?.[0]).toBe(10);
  });

  it('coalesces several updates in one frame into a single redraw', () => {
    const wave = new LiveWave();
    wave.setTiming(0, 1000, 500);
    setup(wave);
    act(() => {
      wave.push(-1, 1);
      wave.push(-1, 1);
      wave.push(-1, 1);
    });
    expect(frames).toHaveLength(1);
  });

  it('draws nothing until the take position is known', () => {
    const wave = new LiveWave();
    setup(wave);
    act(() => wave.push(-1, 1));
    runFrame();
    expect(fillRect).not.toHaveBeenCalled();
  });

  it('exposes a labelled canvas', () => {
    const wave = new LiveWave();
    const { getByLabelText } = setup(wave);
    expect(getByLabelText(/live recording waveform/i).tagName).toBe('CANVAS');
  });
});
