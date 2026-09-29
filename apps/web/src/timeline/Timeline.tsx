import type { TrackDto } from '@sing-along/shared';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { type AudioController, getAudioController } from '../audio/controller';
import { adjustEdge, type LoopRegion } from '../audio/loop';
import type { DraftView } from '../audio/recorder/draftView';
import { type LiveWave, liveWave } from '../audio/recorder/liveWave';
import { type RecordingState, recordingStore } from '../audio/recorder/recordingStore';
import { type StatusState, trackStatusStore } from '../audio/sync';
import { type TransportState, transportStore } from '../audio/transportStore';
import { waveformColor } from '../lib/labels';
import { followScrollLeft, pxToSec, rulerTicks, secToPx, zoomBy } from './math';
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
}

type Gesture =
  | { kind: 'scrub' }
  | { kind: 'ruler'; startX: number; moved: boolean }
  | { kind: 'edge'; edge: 'a' | 'b' };

/** Pointer movement under this many px is a click, not a drag. */
const CLICK_SLOP_PX = 4;

export const LANE_HEIGHT = 168;
export const LANE_MARGIN = 2;
/** Height of the ruler including its border: the track panel column starts below it. */
export const RULER_HEIGHT = 25;
const ZOOM_STEP = 1.25;

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
}: Props) {
  const ctl = controller ?? getAudioController();
  const pxPerSec = useStore(view, (s) => s.pxPerSec);
  const transportDuration = useStore(transport, (s) => s.duration);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<LoopRegion | null>(null);
  const loop = useStore(transport, (s) => s.loop);
  const loopEnabled = useStore(transport, (s) => s.loopEnabled);
  const loopA = useStore(transport, (s) => s.loopA);
  const region = preview ?? loop;
  const anchor = useRef<{ sec: number; x: number } | null>(null);
  const programmatic = useRef<number | null>(null); // scrollLeft we set ourselves
  const [viewport, setViewport] = useState({ left: 0, width: 0 });

  const isRecording = useStore(recording, (s) => s.status === 'recording');
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
        if (next !== el.scrollLeft) {
          programmatic.current = next;
          el.scrollLeft = next;
        }
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
    if (programmatic.current === el.scrollLeft) programmatic.current = null;
    else view.setState({ follow: false }); // dragged the scrollbar / touch scroll
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
    if (g.kind === 'scrub') seekAt(e.clientX);
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
    if (!g) return;
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
      <div className="timeline-controls">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() =>
            view.setState({ pxPerSec: zoomBy(view.getState().pxPerSec, 1 / ZOOM_STEP) })
          }
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
      </div>
      <div
        className="timeline-scroll"
        data-testid="timeline-scroll"
        ref={scroller}
        onScroll={onScroll}
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
              pxPerSec={pxPerSec}
              status={status}
              onRetry={onRetryAudio}
            />
          ))}
          {drafts.map((d) => (
            <DraftLane key={d.id} draft={d} pxPerSec={pxPerSec} status={status} />
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

function Lane({
  track,
  pxPerSec,
  status,
  onRetry,
}: {
  track: TrackDto;
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
      className="lane"
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
  pxPerSec,
  status,
}: {
  draft: DraftView;
  pxPerSec: number;
  status: StoreApi<StatusState>;
}) {
  const state = useStore(status, (s) => s.byId[draft.engineId]);
  const left = secToPx((draft.startOffsetMs + draft.latencyOffsetMs) / 1000, pxPerSec);
  const width = secToPx(draft.durationMs / 1000, pxPerSec);
  return (
    <div
      className="lane draft-lane"
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
      <span className="draft-badge lane-badge">Draft</span>
      {state === 'error' && (
        <div role="status" className="lane-status">
          Couldn't load audio
        </div>
      )}
    </div>
  );
}
