import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftView } from '../audio/recorder/draftView';
import { createTransportStore } from '../audio/transportStore';
import { Timeline } from './Timeline';
import { createViewStore } from './viewStore';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));

const draft = (over: Partial<DraftView> = {}): DraftView => ({
  id: 'd1',
  engineId: -7,
  name: 'Take 1',
  performer: '',
  startOffsetMs: 2000,
  latencyOffsetMs: 500,
  durationMs: 3000,
  peaks: [0.5],
  blob: new Blob([]),
  ...over,
});

let view: ReturnType<typeof createViewStore>;
beforeEach(() => {
  view = createViewStore();
  view.setState({ pxPerSec: 10 });
});

const show = (drafts: DraftView[], duration = 4) => {
  const transport = createTransportStore();
  transport.setState({ duration });
  render(
    <Timeline
      tracks={[]}
      drafts={drafts}
      transport={transport}
      view={view}
      controller={{ seek() {}, setLoopRegion: () => true, adjustLoopEdge() {} } as never}
    />,
  );
};

describe('draft lanes', () => {
  it('draws a draft at start + latency offset, as wide as the take', () => {
    show([draft()]);
    const lane = screen.getByTestId('lane-draft-d1');
    expect(lane.style.left).toBe('25px'); // (2.0 + 0.5) s at 10 px/s
    expect(lane.style.width).toBe('30px');
  });

  it('looks different from an uploaded track: a Draft badge and a draft class', () => {
    show([draft()]);
    const lane = screen.getByTestId('lane-draft-d1');
    expect(lane.className).toMatch(/draft-lane/);
    expect(lane.textContent).toMatch(/draft/i);
  });

  it('extends the timeline when a draft runs past the end', () => {
    show([draft({ startOffsetMs: 8000, durationMs: 4000 })]);
    const width = Number.parseFloat(
      (screen.getByTestId('timeline-content') as HTMLElement).style.width,
    );
    expect(width).toBeGreaterThanOrEqual(120);
  });

  it('shows every draft, in the order given', () => {
    show([draft({ id: 'a', engineId: -1 }), draft({ id: 'b', engineId: -2 })]);
    const ids = screen.getAllByTestId(/lane-draft-/).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['lane-draft-a', 'lane-draft-b']);
  });
});
