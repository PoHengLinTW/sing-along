import type { TrackDto } from '@sing-along/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { type AudioController, getAudioController } from '../audio/controller';
import { type StatusState, trackStatusStore } from '../audio/sync';
import { type TransportState, transportStore } from '../audio/transportStore';
import { followScrollLeft, pxToSec, rulerTicks, secToPx, zoomBy } from './math';
import { type ViewState, viewStore } from './viewStore';
import { Waveform } from './Waveform';

interface Props {
  tracks: TrackDto[];
  controller?: Pick<AudioController, 'seek'>;
  transport?: StoreApi<TransportState>;
  view?: StoreApi<ViewState>;
  status?: StoreApi<StatusState>;
}

export const LANE_HEIGHT = 112;
export const LANE_MARGIN = 2;
/** Height of the ruler including its border: the track panel column starts below it. */
export const RULER_HEIGHT = 25;
const NEUTRAL_COLOR = '#94a3b8';
const ZOOM_STEP = 1.25;

export function Timeline({
  tracks,
  controller,
  transport = transportStore,
  view = viewStore,
  status = trackStatusStore,
}: Props) {
  const ctl = controller ?? getAudioController();
  const pxPerSec = useStore(view, (s) => s.pxPerSec);
  const transportDuration = useStore(transport, (s) => s.duration);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const anchor = useRef<{ sec: number; x: number } | null>(null);
  const programmatic = useRef<number | null>(null); // scrollLeft we set ourselves
  const [viewport, setViewport] = useState({ left: 0, width: 0 });

  const contentSec = Math.max(
    transportDuration,
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

  const seekAt = (clientX: number) => {
    const rect = content.current?.getBoundingClientRect();
    ctl.seek(pxToSec(clientX - (rect?.left ?? 0), view.getState().pxPerSec));
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer scrubbing surface; keyboard seeking is on the transport */}
        <div
          className="timeline-content"
          data-testid="timeline-content"
          ref={content}
          style={{ width: `${contentPx}px` }}
          onPointerDown={(e) => {
            if (e.buttons !== 1) return;
            dragging.current = true;
            view.setState({ follow: true }); // a seek re-enables following
            (e.target as Element).setPointerCapture?.(e.pointerId);
            seekAt(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging.current && e.buttons === 1) seekAt(e.clientX);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
        >
          <div className="ruler" data-testid="ruler">
            {ticks.map((t) => (
              <span key={t.sec} className="tick" style={{ left: `${t.px}px` }}>
                {t.label}
              </span>
            ))}
          </div>
          {tracks.map((track) => (
            <Lane key={track.id} track={track} pxPerSec={pxPerSec} status={status} />
          ))}
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
}: {
  track: TrackDto;
  pxPerSec: number;
  status: StoreApi<StatusState>;
}) {
  const state = useStore(status, (s) => s.byId[track.id]);
  const left = secToPx((track.startOffsetMs + track.latencyOffsetMs) / 1000, pxPerSec);
  const width = secToPx(track.durationMs / 1000, pxPerSec);
  const color = track.labels[0]?.color ?? NEUTRAL_COLOR;
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
          {state === 'error' ? "Couldn't load audio" : 'Loading audio…'}
        </div>
      )}
    </div>
  );
}
