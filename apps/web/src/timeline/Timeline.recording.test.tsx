import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveWave } from '../audio/recorder/liveWave';
import { createRecordingStore } from '../audio/recorder/recordingStore';
import { createTransportStore } from '../audio/transportStore';
import { Timeline } from './Timeline';
import { createViewStore } from './viewStore';

const controller = { seek: vi.fn(), setLoopRegion: vi.fn(), adjustLoopEdge: vi.fn() };
let live: LiveWave;
let recording: ReturnType<typeof createRecordingStore>;
let view: ReturnType<typeof createViewStore>;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  live = new LiveWave();
  recording = createRecordingStore();
  view = createViewStore();
  view.setState({ pxPerSec: 10 });
  const transport = createTransportStore();
  transport.setState({ duration: 20 });
  render(
    <Timeline
      tracks={[]}
      controller={controller as never}
      transport={transport}
      view={view}
      live={live}
      recording={recording}
    />,
  );
});

describe('recording lane', () => {
  it('is absent when not recording', () => {
    expect(screen.queryByTestId('lane-recording')).toBeNull();
  });

  it('appears while recording once the take position is known', () => {
    act(() => recording.setState({ status: 'recording' }));
    expect(screen.queryByTestId('lane-recording')).toBeNull();
    act(() => live.setTiming(5, 1000, 500));
    expect(screen.getByTestId('lane-recording')).toBeTruthy();
    act(() => recording.setState({ status: 'idle' }));
    expect(screen.queryByTestId('lane-recording')).toBeNull();
  });

  it('grows the timeline when the take runs past the last track', () => {
    const width = () =>
      Number.parseFloat((screen.getByTestId('timeline-content') as HTMLElement).style.width);
    expect(width()).toBe(200); // 20 s * 10 px/s
    act(() => recording.setState({ status: 'recording' }));
    act(() => live.setTiming(18, 1000, 1000)); // 1 s blocks
    act(() => {
      for (let i = 0; i < 10; i++) live.push(-0.5, 0.5); // take now ends at 28 s
    });
    expect(width()).toBeGreaterThanOrEqual(280);
  });
});
