import type { TrackDto } from '@sing-along/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftView } from '../audio/recorder/draftView';
import { createRecordingStore } from '../audio/recorder/recordingStore';
import { createStatusStore } from '../audio/sync';
import { createTransportStore } from '../audio/transportStore';
import { Timeline } from './Timeline';
import { createViewStore } from './viewStore';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));

const track = (over: Partial<TrackDto> = {}): TrackDto => ({
  id: 1,
  projectId: 1,
  name: 'Alto',
  performer: null,
  labels: [],
  startOffsetMs: 2000,
  latencyOffsetMs: 500,
  durationMs: 10_000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: 1,
  peaks: [0.5],
  createdAt: '',
  ...over,
});
const draft = {
  id: 'abc',
  engineId: -5,
  startOffsetMs: 1000,
  latencyOffsetMs: 0,
  durationMs: 3000,
  peaks: [0.5],
} as unknown as DraftView;

const controller = { seek: vi.fn(), setLoopRegion: vi.fn(), adjustLoopEdge: vi.fn() };
const onTrackStart = vi.fn();
const onDraftStart = vi.fn();
let recording: ReturnType<typeof createRecordingStore>;

function setup(tracks = [track()], drafts: DraftView[] = []) {
  const view = createViewStore();
  view.setState({ pxPerSec: 50 });
  recording = createRecordingStore();
  return render(
    <Timeline
      tracks={tracks}
      drafts={drafts}
      controller={controller as never}
      transport={createTransportStore()}
      view={view}
      status={createStatusStore()}
      recording={recording}
      onTrackStart={onTrackStart}
      onDraftStart={onDraftStart}
    />,
  );
}
const grip = (id = 'track:1') => screen.getByTestId(`grip-${id}`);

beforeEach(() => {
  for (const fn of [controller.seek, controller.setLoopRegion, onTrackStart, onDraftStart])
    fn.mockClear();
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

describe('dragging a lane to set its start time', () => {
  it('each lane has a labelled grip showing its start time', () => {
    setup([track()], [draft]);
    expect(grip().textContent).toContain('00:02.500');
    expect(grip().getAttribute('aria-label')).toMatch(/move alto/i);
    expect(grip('draft:abc').textContent).toContain('00:01.000');
  });

  it('dragging the grip reports the new start time as it moves', () => {
    setup();
    fireEvent.pointerDown(grip(), { clientX: 100, buttons: 1 });
    fireEvent.pointerMove(grip(), { clientX: 150, buttons: 1 }); // +50 px = +1 s
    expect(onTrackStart).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }), 3500);
    fireEvent.pointerMove(grip(), { clientX: 75, buttons: 1 }); // -25 px = -0.5 s from the start
    expect(onTrackStart).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }), 2000);
  });

  it('measures from where the drag began, even though the track moves under the pointer', () => {
    const { rerender } = setup();
    fireEvent.pointerDown(grip(), { clientX: 100, buttons: 1 });
    fireEvent.pointerMove(grip(), { clientX: 150, buttons: 1 });
    rerender(
      <Timeline
        tracks={[track({ latencyOffsetMs: 1500 })]}
        controller={controller as never}
        transport={createTransportStore()}
        view={createViewStore()}
        status={createStatusStore()}
        onTrackStart={onTrackStart}
      />,
    );
    fireEvent.pointerMove(grip(), { clientX: 200, buttons: 1 });
    expect(onTrackStart).toHaveBeenLastCalledWith(expect.anything(), 4500); // 2.5 s + 100 px
  });

  it('cannot be dragged before the song starts', () => {
    setup();
    fireEvent.pointerDown(grip(), { clientX: 1000, buttons: 1 });
    fireEvent.pointerMove(grip(), { clientX: 0, buttons: 1 });
    expect(onTrackStart).toHaveBeenLastCalledWith(expect.anything(), 0);
  });

  it('a drag does not move the playhead, and a click on the grip does not seek', () => {
    setup();
    fireEvent.pointerDown(grip(), { clientX: 100, buttons: 1 });
    fireEvent.pointerMove(grip(), { clientX: 150, buttons: 1 });
    fireEvent.pointerUp(grip(), { clientX: 150 });
    expect(controller.seek).not.toHaveBeenCalled();
  });

  it('a click without movement changes nothing', () => {
    setup();
    fireEvent.pointerDown(grip(), { clientX: 100, buttons: 1 });
    fireEvent.pointerUp(grip(), { clientX: 100 });
    expect(onTrackStart).not.toHaveBeenCalled();
  });

  it('stops following the pointer once it is released', () => {
    setup();
    fireEvent.pointerDown(grip(), { clientX: 100, buttons: 1 });
    fireEvent.pointerUp(grip(), { clientX: 100 });
    fireEvent.pointerMove(grip(), { clientX: 300, buttons: 1 });
    expect(onTrackStart).not.toHaveBeenCalled();
  });

  it('moves a draft the same way', () => {
    setup([track()], [draft]);
    fireEvent.pointerDown(grip('draft:abc'), { clientX: 0, buttons: 1 });
    fireEvent.pointerMove(grip('draft:abc'), { clientX: 100, buttons: 1 });
    expect(onDraftStart).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'abc' }), 3000);
    expect(onTrackStart).not.toHaveBeenCalled();
  });

  it('the rest of the lane still scrubs the playhead', () => {
    setup();
    fireEvent.pointerDown(screen.getByTestId('lane-1'), { clientX: 120, buttons: 1 });
    expect(controller.seek).toHaveBeenCalled();
    expect(onTrackStart).not.toHaveBeenCalled();
  });

  it('is locked while a take is open', () => {
    setup();
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.pointerDown(grip(), { clientX: 100, buttons: 1 });
    fireEvent.pointerMove(grip(), { clientX: 200, buttons: 1 });
    expect(onTrackStart).not.toHaveBeenCalled();
  });

  it('shows the grabbing state while dragging', () => {
    setup();
    fireEvent.pointerDown(grip(), { clientX: 100, buttons: 1 });
    expect(screen.getByTestId('lane-1').className).toMatch(/moving/);
    fireEvent.pointerUp(grip(), { clientX: 100 });
    expect(screen.getByTestId('lane-1').className).not.toMatch(/moving/);
  });
});

describe('trim handles on a local take', () => {
  const onDraftTrim = vi.fn();
  const handle = (edge: 'start' | 'end') => screen.getByTestId(`trim-${edge}-draft:abc`);
  // the draft starts at 1 s and lasts 3 s: its lane spans 1 s .. 4 s = 50 .. 200 px at 50 px/s
  function setupTrim(drafts: DraftView[] = [draft]) {
    const view = createViewStore();
    view.setState({ pxPerSec: 50 });
    recording = createRecordingStore();
    return render(
      <Timeline
        tracks={[]}
        drafts={drafts}
        controller={controller as never}
        transport={createTransportStore()}
        view={view}
        status={createStatusStore()}
        recording={recording}
        onDraftTrim={onDraftTrim}
      />,
    );
  }
  beforeEach(() => onDraftTrim.mockClear());

  it('a local take has a handle at each end, and an uploaded track has none', () => {
    setupTrim();
    expect(handle('start').getAttribute('aria-label')).toMatch(/trim the start of/i);
    expect(handle('end').getAttribute('aria-label')).toMatch(/trim the end of/i);
    expect(screen.queryByTestId('trim-start-track:1')).toBeNull();
  });

  it('dragging the start handle trims there when it is released, not before', () => {
    setupTrim();
    fireEvent.pointerDown(handle('start'), { clientX: 50, buttons: 1 });
    fireEvent.pointerMove(handle('start'), { clientX: 100, buttons: 1 }); // 2 s
    expect(onDraftTrim).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle('start'), { clientX: 100 });
    expect(onDraftTrim).toHaveBeenCalledWith(expect.objectContaining({ id: 'abc' }), 'start', 2000);
  });

  it('dragging the end handle trims the end', () => {
    setupTrim();
    fireEvent.pointerDown(handle('end'), { clientX: 200, buttons: 1 });
    fireEvent.pointerMove(handle('end'), { clientX: 150, buttons: 1 }); // 3 s
    fireEvent.pointerUp(handle('end'), { clientX: 150 });
    expect(onDraftTrim).toHaveBeenCalledWith(expect.objectContaining({ id: 'abc' }), 'end', 3000);
  });

  it('shows what will be cut while dragging, and removes it afterwards', () => {
    setupTrim();
    fireEvent.pointerDown(handle('start'), { clientX: 50, buttons: 1 });
    fireEvent.pointerMove(handle('start'), { clientX: 100, buttons: 1 });
    const cut = screen.getByTestId('trim-preview-draft:abc');
    expect(cut.getAttribute('data-edge')).toBe('start');
    expect(cut.style.width).toBe('50px'); // 1 s .. 2 s
    expect(screen.getByTestId('lane-draft-abc').className).toMatch(/trimming/);
    fireEvent.pointerUp(handle('start'), { clientX: 100 });
    expect(screen.queryByTestId('trim-preview-draft:abc')).toBeNull();
  });

  it('a click without dragging trims nothing, and a drag outward trims nothing', () => {
    setupTrim();
    fireEvent.pointerDown(handle('start'), { clientX: 50, buttons: 1 });
    fireEvent.pointerUp(handle('start'), { clientX: 50 });
    fireEvent.pointerDown(handle('end'), { clientX: 200, buttons: 1 });
    fireEvent.pointerMove(handle('end'), { clientX: 260, buttons: 1 });
    fireEvent.pointerUp(handle('end'), { clientX: 260 });
    expect(onDraftTrim).not.toHaveBeenCalled();
  });

  it('keeps 100 ms of the take however far the handle is dragged', () => {
    setupTrim();
    fireEvent.pointerDown(handle('start'), { clientX: 50, buttons: 1 });
    fireEvent.pointerMove(handle('start'), { clientX: 700, buttons: 1 });
    fireEvent.pointerUp(handle('start'), { clientX: 700 });
    expect(onDraftTrim).toHaveBeenCalledWith(expect.anything(), 'start', 3900);
  });

  it('does not move the playhead or the lane', () => {
    setupTrim();
    fireEvent.pointerDown(handle('start'), { clientX: 50, buttons: 1 });
    fireEvent.pointerMove(handle('start'), { clientX: 100, buttons: 1 });
    fireEvent.pointerUp(handle('start'), { clientX: 100 });
    expect(controller.seek).not.toHaveBeenCalled();
    expect(onDraftStart).not.toHaveBeenCalled();
  });

  it('is locked while a take is open', () => {
    setupTrim();
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.pointerDown(handle('start'), { clientX: 50, buttons: 1 });
    fireEvent.pointerMove(handle('start'), { clientX: 100, buttons: 1 });
    fireEvent.pointerUp(handle('start'), { clientX: 100 });
    expect(onDraftTrim).not.toHaveBeenCalled();
  });

  it('works from the keyboard: arrows move the handle inward by 100 ms, Shift by 1 s', () => {
    setupTrim();
    fireEvent.keyDown(handle('start'), { key: 'ArrowRight' });
    expect(onDraftTrim).toHaveBeenLastCalledWith(expect.anything(), 'start', 1100);
    fireEvent.keyDown(handle('end'), { key: 'ArrowLeft', shiftKey: true });
    expect(onDraftTrim).toHaveBeenLastCalledWith(expect.anything(), 'end', 3000);
    onDraftTrim.mockClear();
    fireEvent.keyDown(handle('start'), { key: 'ArrowLeft' }); // outward: nothing to restore
    fireEvent.keyDown(handle('end'), { key: 'ArrowRight' });
    expect(onDraftTrim).not.toHaveBeenCalled();
  });
});
