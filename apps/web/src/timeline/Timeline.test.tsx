import type { TrackDto } from '@sing-along/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusStore } from '../audio/sync';
import { createTransportStore } from '../audio/transportStore';
import { Timeline } from './Timeline';
import { createViewStore } from './viewStore';

const ws = vi.hoisted(() => ({
  create: vi.fn(),
  instances: [] as {
    setOptions: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    opts: Record<string, unknown>;
  }[],
}));
vi.mock('wavesurfer.js', () => ({
  default: {
    create: (opts: Record<string, unknown>) => {
      ws.create(opts);
      const inst = { setOptions: vi.fn(), destroy: vi.fn(), opts };
      ws.instances.push(inst);
      return inst;
    },
  },
}));

const track = (id: number, over: Partial<TrackDto> = {}): TrackDto => ({
  id,
  projectId: 1,
  name: `Track ${id}`,
  performer: null,
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 10_000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: id,
  peaks: [0.1, 0.5, 0.9],
  createdAt: '',
  ...over,
});

let transport: ReturnType<typeof createTransportStore>;
let view: ReturnType<typeof createViewStore>;
let status: ReturnType<typeof createStatusStore>;
const controller = { seek: vi.fn(), toggle: vi.fn(), play: vi.fn(), pause: vi.fn() };

function setup(tracks: TrackDto[]) {
  return render(
    <Timeline
      tracks={tracks}
      controller={controller as never}
      transport={transport}
      view={view}
      status={status}
    />,
  );
}
const scroller = () => screen.getByTestId('timeline-scroll') as HTMLElement;
const content = () => screen.getByTestId('timeline-content') as HTMLElement;

beforeEach(() => {
  transport = createTransportStore();
  view = createViewStore();
  status = createStatusStore();
  ws.instances.length = 0;
  ws.create.mockClear();
  controller.seek.mockClear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {},
  });
});
afterEach(() => vi.restoreAllMocks());

describe('lanes', () => {
  it('renders one lane per track, positioned and sized by offsets and zoom', () => {
    view.setState({ pxPerSec: 40 });
    setup([
      track(1, { startOffsetMs: 2000, latencyOffsetMs: 500 }),
      track(2, { durationMs: 5000 }),
    ]);
    const lane1 = screen.getByTestId('lane-1');
    expect(lane1.style.left).toBe('100px'); // (2000 + 500) ms x 40 px/s
    expect(lane1.style.width).toBe('400px'); // 10 s x 40
    expect(screen.getByTestId('lane-2').style.left).toBe('0px');
    expect(screen.getByTestId('lane-2').style.width).toBe('200px');
  });

  it('draws waveforms from the stored peaks and duration, without the audio', () => {
    setup([track(1)]);
    const opts = ws.instances[0]?.opts as { peaks: Float32Array[]; duration: number; url?: string };
    expect(Array.from(opts.peaks[0] ?? [])).toEqual([0.1, 0.5, 0.9].map(Math.fround));
    expect(opts.duration).toBe(10);
    expect(opts.url).toBeUndefined();
  });

  it('shows a loading indicator per track until its buffer is ready', () => {
    status.setState({ byId: { 1: 'loading', 2: 'ready' } });
    setup([track(1), track(2)]);
    expect(within(screen.getByTestId('lane-1')).getByRole('status').textContent).toMatch(
      /loading/i,
    );
    expect(within(screen.getByTestId('lane-2')).queryByRole('status')).toBeNull();
    act(() => status.setState({ byId: { 1: 'ready', 2: 'ready' } }));
    expect(within(screen.getByTestId('lane-1')).queryByRole('status')).toBeNull();
  });

  it('shows an error state when the audio could not be loaded', () => {
    status.setState({ byId: { 1: 'error' } });
    setup([track(1)]);
    expect(within(screen.getByTestId('lane-1')).getByRole('status').textContent).toMatch(
      /couldn't load/i,
    );
  });

  it('updates the waveform zoom when the zoom level changes', () => {
    setup([track(1)]);
    act(() => view.setState({ pxPerSec: 100 }));
    expect(ws.instances[0]?.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ minPxPerSec: 100 }),
    );
  });

  it('destroys waveforms on unmount', () => {
    const { unmount } = setup([track(1)]);
    unmount();
    expect(ws.instances[0]?.destroy).toHaveBeenCalled();
  });
});

describe('ruler', () => {
  it('shows mm:ss marks that adapt to the zoom level', () => {
    view.setState({ pxPerSec: 100 });
    setup([track(1)]);
    expect(within(screen.getByTestId('ruler')).getByText('0:05')).toBeTruthy();
    act(() => view.setState({ pxPerSec: 10 }));
    expect(within(screen.getByTestId('ruler')).queryByText('0:05')).toBeNull(); // step is 10 s now
    expect(within(screen.getByTestId('ruler')).getByText('0:10')).toBeTruthy();
  });
});

describe('playhead', () => {
  it('follows the transport position at the current zoom', () => {
    view.setState({ pxPerSec: 50 });
    setup([track(1)]);
    act(() => transport.setState({ position: 3.2 }));
    expect(screen.getByTestId('playhead').style.left).toBe('160px');
  });
});

describe('seeking', () => {
  it('clicking the ruler or a lane seeks to that time', () => {
    view.setState({ pxPerSec: 50 });
    setup([track(1)]);
    fireEvent.pointerDown(screen.getByTestId('ruler'), { clientX: 250, buttons: 1 });
    expect(controller.seek).toHaveBeenLastCalledWith(5);
    fireEvent.pointerDown(screen.getByTestId('lane-1'), { clientX: 100, buttons: 1 });
    expect(controller.seek).toHaveBeenLastCalledWith(2);
  });

  it('dragging keeps seeking', () => {
    view.setState({ pxPerSec: 50 });
    setup([track(1)]);
    const ruler = screen.getByTestId('ruler');
    fireEvent.pointerDown(ruler, { clientX: 50, buttons: 1 });
    fireEvent.pointerMove(ruler, { clientX: 150, buttons: 1 });
    expect(controller.seek).toHaveBeenLastCalledWith(3);
    fireEvent.pointerMove(ruler, { clientX: 500, buttons: 0 }); // button released: ignored
    expect(controller.seek).toHaveBeenLastCalledWith(3);
  });
});

describe('zoom', () => {
  it('zoom buttons change the zoom within limits', () => {
    view.setState({ pxPerSec: 50 });
    setup([track(1)]);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(view.getState().pxPerSec).toBeGreaterThan(50);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(view.getState().pxPerSec).toBeLessThan(50);
  });

  it('Ctrl/Cmd + wheel zooms and prevents the page zoom; plain wheel does not zoom', () => {
    view.setState({ pxPerSec: 50 });
    setup([track(1)]);
    const evt = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    scroller().dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(view.getState().pxPerSec).toBeGreaterThan(50);
    const before = view.getState().pxPerSec;
    scroller().dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }),
    );
    expect(view.getState().pxPerSec).toBe(before);
  });
});

describe('auto-follow', () => {
  const viewport = (w: number) =>
    Object.defineProperty(scroller(), 'clientWidth', { value: w, configurable: true });

  it('scrolls to keep the playhead in view while playing', () => {
    view.setState({ pxPerSec: 100 });
    setup([track(1, { durationMs: 60_000 })]);
    viewport(1000);
    act(() => transport.setState({ playing: true, duration: 60 }));
    act(() => transport.setState({ position: 9.5 })); // 950 px: beyond 90% of the view
    expect(scroller().scrollLeft).toBe(850);
  });

  it('stops following once the user scrolls away, and resumes on the next seek', () => {
    view.setState({ pxPerSec: 100 });
    setup([track(1, { durationMs: 60_000 })]);
    viewport(1000);
    act(() => transport.setState({ playing: true, duration: 60 }));
    fireEvent.wheel(scroller(), { deltaX: 120 }); // user scrolls sideways
    act(() => transport.setState({ position: 9.5 }));
    expect(scroller().scrollLeft).toBe(0);
    fireEvent.pointerDown(screen.getByTestId('ruler'), { clientX: 300, buttons: 1 }); // a seek re-enables follow
    act(() => transport.setState({ position: 12 }));
    expect(scroller().scrollLeft).toBeGreaterThan(0);
  });

  it('does not scroll while paused', () => {
    view.setState({ pxPerSec: 100 });
    setup([track(1, { durationMs: 60_000 })]);
    viewport(1000);
    act(() => transport.setState({ playing: false, position: 30 }));
    expect(scroller().scrollLeft).toBe(0);
  });
});

it('exposes the content width from the project duration', () => {
  view.setState({ pxPerSec: 20 });
  setup([track(1, { durationMs: 30_000 })]);
  act(() => transport.setState({ duration: 30 }));
  expect(content().style.width).toBe('600px');
});
