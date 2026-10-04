import type { TrackDto } from '@sing-along/shared';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { type AudioController, getAudioController } from '../audio/controller';
import { adjustEdge, type LoopRegion } from '../audio/loop';
import type { DraftView } from '../audio/recorder/draftView';
import { type LiveWave, liveWave } from '../audio/recorder/liveWave';
import { isTakeOpen, type RecordingState, recordingStore } from '../audio/recorder/recordingStore';
import { type StatusState, trackStatusStore } from '../audio/sync';
import { type TransportState, transportStore } from '../audio/transportStore';
import { waveformColor } from '../lib/labels';
import { formatStartTime, startTimeOf } from '../lib/startTime';
import { dragStartMs, followScrollLeft, pxToSec, rulerTicks, secToPx, zoomBy } from './math';
import { RecordingLane } from './RecordingLane';
import { type ViewState, viewStore } from './viewStore';
import { Waveform } from './Waveform';

interface Props {
  tracks: TrackDto[];
  drafts?: DraftView[];
  controller?: Pick<AudioController, 'seek' | 'setLoopRegion' | 'adjustLoopEdge'>;
  transport?: StoreApi<TransportState>;
  view?: StoreApi<ViewState>;
  status?: StoreApi<StatusState>;
  live?: LiveWave;
  recording?: StoreApi<RecordingState>;
  /** Reload a track whose audio failed to download. */
  onRetryAudio?: (trackId: number) => void;
  /** The studio places zoom beside the section heading so it stays visible on narrow screens. */
  showZoomControls?: boolean;
  /** A lane's grip was dragged: its new start time on the song timeline, in ms. */
  onTrackStart?: (track: TrackDto, startMs: number) => void;
  onDraftStart?: (draft: DraftView, startMs: number) => void;
}

type Gesture =
  | { kind: 'scrub' }
  | { kind: 'ruler'; startX: number; moved: boolean }
  | { kind: 'edge'; edge: 'a' | 'b' }
  | { kind: 'move'; lane: string; startX: number; startMs: number; moved: boolean };

/** Pointer movement under this many px is a click, not a drag. */
const CLICK_SLOP_PX = 4;

export const LANE_HEIGHT = 196;
export const LANE_MARGIN = 2;
/** Height of the ruler including its border: the track panel column starts below it. */
export const RULER_HEIGHT = 44;
const ZOOM_STEP = 1.25;

export function TimelineZoomControls({ view = viewStore }: { view?: StoreApi<ViewState> }) {
  return (
    <fieldset className="timeline-controls" aria-label="Timeline zoom">
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => view.setState({ pxPerSec: zoomBy(view.getState().pxPerSec, 1 / ZOOM_STEP) })}
      >
        −
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => view.setState({ pxPerSec: zoomBy(view.getState().pxPerSec, ZOOM_STEP) })}
      >
        +
      </button>
    </fieldset>
  );
}

export function Timeline({
  tracks,
  drafts = [],
  controller,
  transport = transportStore,
  view = viewStore,
  status = trackStatusStore,
  live = liveWave,
  recording = recordingStore,
  onRetryAudio,
  showZoomControls = true,
  onTrackStart,
  onDraftStart,
}: Props) {
  const ctl = controller ?? getAudioController();
  const pxPerSec = useStore(view, (s) => s.pxPerSec);
  const transportDuration = useStore(transport, (s) => s.duration);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<LoopRegion | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const loop = useStore(transport, (s) => s.loop);
  const loopEnabled = useStore(transport, (s) => s.loopEnabled);
  const loopA = useStore(transport, (s) => s.loopA);
  const region = preview ?? loop;
  const anchor = useRef<{ sec: number; x: number } | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 0 });

  const isRecording = useStore(recording, (s) => isTakeOpen(s.status));
  // Whole seconds only: this re-renders once a second while a take grows, not on every block.
  const liveEndSec = useSyncExternalStore(
    (fn) => live.subscribe(fn),
    () => Math.ceil(live.endSec),
  );
  const showLiveLane = isRecording && live.timed;

  const contentSec = Math.max(
    transportDuration,
    showLiveLane ? liveEndSec + 1 : 0,
    ...drafts.map((d) => (d.startOffsetMs + d.latencyOffsetMs + d.durationMs) / 1000),
    ...tracks.map((t) => (t.startOffsetMs + t.latencyOffsetMs + t.durationMs) / 1000),
  );
  const contentPx = secToPx(contentSec, pxPerSec);

  // Playhead and auto-follow live outside React state: the position changes every frame,
  // so we write straight to the DOM and only React-render what is not per-frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribe on zoom/size changes
  useEffect(() => {
    const apply = () => {
      const { position, playing } = transport.getState();
      const x = secToPx(position, view.getState().pxPerSec);
      if (playhead.current) playhead.current.style.left = `${x}px`;
      const el = scroller.current;
      if (el && playing && view.getState().follow) {
        const next = followScrollLeft({
          scrollLeft: el.scrollLeft,
          viewportWidth: el.clientWidth,
          contentWidth: contentPx,
          playheadPx: x,
        });
        if (next !== el.scrollLeft) el.scrollLeft = next;
      }
    };
    apply();
    return transport.subscribe(apply);
  }, [transport, view, pxPerSec, contentPx]);

  // Keep the time under the cursor fixed while zooming (set by the wheel handler).
  useLayoutEffect(() => {
    if (anchor.current && scroller.current) {
      scroller.current.scrollLeft = Math.max(
        0,
        secToPx(anchor.current.sec, pxPerSec) - anchor.current.x,
      );
    }
    anchor.current = null;
  }, [pxPerSec]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // otherwise the browser zooms the whole page
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const current = view.getState().pxPerSec;
        anchor.current = { sec: (el.scrollLeft + x) / current, x };
        view.setState({ pxPerSec: zoomBy(current, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP) });
      } else if (e.deltaX !== 0 || e.shiftKey) {
        view.setState({ follow: false }); // the user is scrolling sideways: stop following
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setViewport({ left: el.scrollLeft, width: el.clientWidth });
  };

  const secAt = (clientX: number) => {
    const rect = content.current?.getBoundingClientRect();
    return pxToSec(clientX - (rect?.left ?? 0), view.getState().pxPerSec);
  };
  const seekAt = (clientX: number) => ctl.seek(secAt(clientX));

  // A gesture is one of: scrubbing a lane, dragging on the ruler (click = seek, drag = new loop),
  // or dragging a loop edge handle. The kind is decided on pointer down.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    const target = e.target as Element;
    (target as Element).setPointerCapture?.(e.pointerId);
    const handle = target.closest('[data-loop-handle]')?.getAttribute('data-loop-handle');
    if (handle === 'a' || handle === 'b') {
      gesture.current = { kind: 'edge', edge: handle };
      return;
    }
    const grip = target.closest('[data-lane-grip]')?.getAttribute('data-lane-grip');
    if (grip) {
      // The grip moves its lane in time; it never seeks. Locked while a take runs.
      if (isRecording) return;
      const [type, id] = grip.split(':');
      const item =
        type === 'track'
          ? tracks.find((t) => String(t.id) === id)
          : drafts.find((d) => d.id === id);
      if (!item) return;
      gesture.current = {
        kind: 'move',
        lane: grip,
        startX: e.clientX,
        startMs: startTimeOf(item),
        moved: false,
      };
      setMoving(grip);
      return;
    }
    view.setState({ follow: true }); // a seek re-enables following
    if (target.closest('[data-testid="ruler"]')) {
      gesture.current = { kind: 'ruler', startX: e.clientX, moved: false };
      return;
    }
    gesture.current = { kind: 'scrub' };
    seekAt(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || e.buttons !== 1) return;
    if (g.kind === 'move') {
      const dx = e.clientX - g.startX;
      if (!g.moved && Math.abs(dx) <= CLICK_SLOP_PX) return;
      g.moved = true;
      const [type, id] = g.lane.split(':');
      const startMs = dragStartMs(g.startMs, dx, view.getState().pxPerSec);
      if (type === 'track') {
        const t = tracks.find((x) => String(x.id) === id);
        if (t) onTrackStart?.(t, startMs);
      } else {
        const d = drafts.find((x) => x.id === id);
        if (d) onDraftStart?.(d, startMs);
      }
    } else if (g.kind === 'scrub') seekAt(e.clientX);
    else if (g.kind === 'ruler') {
      if (Math.abs(e.clientX - g.startX) > CLICK_SLOP_PX) g.moved = true;
      if (g.moved) {
        const a = secAt(g.startX);
        const b = secAt(e.clientX);
        setPreview({ a: Math.min(a, b), b: Math.max(a, b) });
      }
    } else if (loop) {
      setPreview(adjustEdge(loop, g.edge, secAt(e.clientX), Math.max(contentSec, loop.b)));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setPreview(null);
    setMoving(null);
    if (!g || g.kind === 'move') return;
    if (g.kind === 'ruler') {
      if (!g.moved)
        seekAt(e.clientX); // a plain click on the ruler seeks
      else {
        const a = secAt(g.startX);
        const b = secAt(e.clientX);
        ctl.setLoopRegion({ a: Math.min(a, b), b: Math.max(a, b) });
      }
    } else if (g.kind === 'edge') {
      ctl.adjustLoopEdge(g.edge, secAt(e.clientX));
    }
  };

  const from = viewport.width ? Math.max(0, (viewport.left - viewport.width) / pxPerSec) : 0;
  const to = viewport.width ? (viewport.left + viewport.width * 2) / pxPerSec : contentSec;
  const { ticks } = rulerTicks({ pxPerSec, fromSec: from, toSec: Math.min(to, contentSec) });

  return (
    <div className="timeline">
      {showZoomControls && <TimelineZoomControls view={view} />}
      <div
        className="timeline-scroll"
        data-testid="timeline-scroll"
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) view.setState({ follow: false }); // scrollbar drag
        }}
      >
        <div
          className="timeline-content"
          data-testid="timeline-content"
          ref={content}
          style={{ width: `${contentPx}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="ruler" data-testid="ruler">
            {ticks.map((t) => (
              <span key={t.sec} className="tick" style={{ left: `${t.px}px` }}>
                {t.label}
              </span>
            ))}
          </div>
          {tracks.map((track) => (
            <Lane
              key={track.id}
              track={track}
              moving={moving === `track:${track.id}`}
              pxPerSec={pxPerSec}
              status={status}
              onRetry={onRetryAudio}
            />
          ))}
          {drafts.map((d) => (
            <DraftLane
              key={d.id}
              draft={d}
              moving={moving === `draft:${d.id}`}
              pxPerSec={pxPerSec}
              status={status}
            />
          ))}
          {showLiveLane && (
            <div
              className="recording-lane"
              data-testid="lane-recording"
              style={{ height: `${LANE_HEIGHT}px` }}
            >
              <RecordingLane
                wave={live}
                pxPerSec={pxPerSec}
                scroller={scroller}
                height={LANE_HEIGHT}
                color="#e11d48"
              />
            </div>
          )}
          {region && (
            <div
              className="loop-region"
              data-testid="loop-region"
              data-enabled={String(loopEnabled || preview !== null)}
              style={{
                left: `${secToPx(region.a, pxPerSec)}px`,
                width: `${secToPx(region.b - region.a, pxPerSec)}px`,
              }}
            >
              <span className="loop-handle" data-testid="loop-handle-a" data-loop-handle="a" />
              <span className="loop-handle b" data-testid="loop-handle-b" data-loop-handle="b" />
            </div>
          )}
          {loopA !== null && !loop && (
            <div
              className="loop-a-marker"
              data-testid="loop-a-marker"
              style={{ left: `${secToPx(loopA, pxPerSec)}px` }}
            />
          )}
          <div className="playhead" data-testid="playhead" ref={playhead} />
        </div>
      </div>
    </div>
  );
}

/** The strip on top of a lane that is dragged to move it in time. */
function LaneGrip({ id, name, startMs }: { id: string; name: string; startMs: number }) {
  return (
    <div
      className="lane-grip"
      data-testid={`grip-${id}`}
      data-lane-grip={id}
      role="presentation"
      aria-label={`Move ${name} in time: drag, or type its Start time in the panel`}
      title="Drag to move this track in time"
    >
      <span aria-hidden="true">⠿</span> {formatStartTime(startMs)}
    </div>
  );
}

function Lane({
  track,
  moving,
  pxPerSec,
  status,
  onRetry,
}: {
  track: TrackDto;
  moving: boolean;
  pxPerSec: number;
  status: StoreApi<StatusState>;
  onRetry?: (trackId: number) => void;
}) {
  const state = useStore(status, (s) => s.byId[track.id]);
  const left = secToPx((track.startOffsetMs + track.latencyOffsetMs) / 1000, pxPerSec);
  const width = secToPx(track.durationMs / 1000, pxPerSec);
  const color = waveformColor(track);
  return (
    <div
      className={moving ? 'lane moving' : 'lane'}
      data-testid={`lane-${track.id}`}
      style={{ left: `${left}px`, width: `${width}px`, height: `${LANE_HEIGHT}px` }}
    >
      <Waveform
        peaks={track.peaks}
        durationSec={track.durationMs / 1000}
        pxPerSec={pxPerSec}
        color={color}
        height={LANE_HEIGHT}
      />
      <LaneGrip id={`track:${track.id}`} name={track.name} startMs={startTimeOf(track)} />
      {state !== 'ready' && (
        <div role="status" className="lane-status">
          {state === 'error' ? (
            <>
              Failed to load audio —{' '}
              <button
                type="button"
                // The lane background scrubs the playhead: keep this click out of that gesture.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRetry?.(track.id)}
              >
                Retry
              </button>
            </>
          ) : (
            'Loading audio…'
          )}
        </div>
      )}
    </div>
  );
}

function DraftLane({
  draft,
  moving,
  pxPerSec,
  status,
}: {
  draft: DraftView;
  moving: boolean;
  pxPerSec: number;
  status: StoreApi<StatusState>;
}) {
  const state = useStore(status, (s) => s.byId[draft.engineId]);
  const left = secToPx((draft.startOffsetMs + draft.latencyOffsetMs) / 1000, pxPerSec);
  const width = secToPx(draft.durationMs / 1000, pxPerSec);
  return (
    <div
      className={moving ? 'lane draft-lane moving' : 'lane draft-lane'}
      data-testid={`lane-draft-${draft.id}`}
      style={{ left: `${left}px`, width: `${width}px`, height: `${LANE_HEIGHT}px` }}
    >
      <Waveform
        peaks={draft.peaks}
        durationSec={draft.durationMs / 1000}
        pxPerSec={pxPerSec}
        color="#64748b"
        height={LANE_HEIGHT}
      />
      <LaneGrip id={`draft:${draft.id}`} name={draft.name} startMs={startTimeOf(draft)} />
      <span className="draft-badge lane-badge">Draft</span>
      {state === 'error' && (
        <div role="status" className="lane-status">
          Couldn't load audio
        </div>
      )}
    </div>
  );
}
