import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { formatStartTime } from '../../lib/startTime';
import { useToast } from '../../ui/toast';
import { type TransportState, transportStore } from '../transportStore';
import { isClipping, levelFraction } from './level';
import { type LevelStoreState, levelStore } from './levelStore';
import { type LiveWave, liveWave, tailColumns } from './liveWave';
import { type RecordingState, recordingStore } from './recordingStore';
import { getRecordingSession, type RecordingSession } from './session';

/** The strip shows this many seconds of the take; blocks are ~21 ms, so a few hundred. */
const WINDOW_SEC = 8;

interface Props {
  session?: Pick<RecordingSession, 'pause' | 'resume' | 'stop' | 'setMuted'>;
  recording?: StoreApi<RecordingState>;
  levels?: StoreApi<LevelStoreState>;
  transport?: StoreApi<TransportState>;
  live?: LiveWave;
}

const STATUS_TEXT: Record<RecordingState['status'], string> = {
  idle: '',
  starting: 'Starting…',
  recording: 'Recording',
  paused: 'Paused',
  stopping: 'Finishing…',
};

/**
 * The recording sheet: opens from the bottom for as long as a take is open. Live waveform on top,
 * the song position and the recorded time (they differ once the take was paused), the input
 * level, then Pause/Resume, Mute microphone and Finish. It has no close button and ignores Escape,
 * so a take can only end through Finish.
 */
export function RecordingSheet({
  session,
  recording = recordingStore,
  levels = levelStore,
  transport = transportStore,
  live = liveWave,
}: Props) {
  const status = useStore(recording, (s) => s.status);
  const muted = useStore(recording, (s) => s.muted);
  const level = useStore(levels, (s) => s.level);
  const clipUntil = useStore(levels, (s) => s.clipUntil);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, redraw] = useState(0);

  // The warning ends 2 s after the last clip with no level update to trigger a render.
  useEffect(() => {
    const left = clipUntil - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => redraw((n) => n + 1), left);
    return () => clearTimeout(id);
  }, [clipUntil]);

  if (status === 'idle') return null;

  const transitioning = status === 'starting' || status === 'stopping' || busy;
  const port = () => session ?? getRecordingSession();

  const finish = async () => {
    if (transitioning) return;
    setBusy(true);
    try {
      await port().stop();
    } catch {
      toast.error("Couldn't finish the recording. Try Finish again.");
    } finally {
      setBusy(false);
    }
  };
  const togglePause = async () => {
    if (transitioning) return;
    if (status === 'recording') port().pause();
    else if (status === 'paused') {
      setBusy(true);
      try {
        await port().resume();
      } finally {
        setBusy(false);
      }
    }
  };

  const statusText =
    status === 'recording' && muted
      ? 'Recording: microphone muted, silence is recorded'
      : status === 'paused' && muted
        ? 'Paused, microphone muted'
        : STATUS_TEXT[status];

  return (
    <section className="recording-sheet" aria-label="Recording">
      <p className="sheet-status" role="status">
        {statusText}
      </p>
      <LiveStrip live={live} />
      <Times transport={transport} recording={recording} />
      <div className="sheet-level">
        <meter aria-label="Input level" min={0} max={1} value={levelFraction(level)} />
        {isClipping({ level, clipUntil }, Date.now()) && (
          <span className="clip-warning">Clipping: lower your microphone level</span>
        )}
      </div>
      <div className="sheet-controls">
        {status === 'paused' ? (
          <button type="button" disabled={transitioning} onClick={() => void togglePause()}>
            <span aria-hidden="true">▶ </span>Resume recording
          </button>
        ) : (
          <button type="button" disabled={transitioning} onClick={() => void togglePause()}>
            <span aria-hidden="true">⏸ </span>Pause recording
          </button>
        )}
        <button
          type="button"
          className={muted ? 'mic-mute muted' : 'mic-mute'}
          aria-pressed={muted}
          disabled={status === 'starting' || status === 'stopping'}
          onClick={() => port().setMuted(!muted)}
        >
          {muted ? 'Unmute microphone' : 'Mute microphone'}
        </button>
        <button
          type="button"
          className="record recording"
          disabled={transitioning}
          onClick={() => void finish()}
        >
          <span aria-hidden="true">■ </span>Finish recording
        </button>
      </div>
    </section>
  );
}

function Times({
  transport,
  recording,
}: {
  transport: StoreApi<TransportState>;
  recording: StoreApi<RecordingState>;
}) {
  const position = useStore(transport, (s) => s.position);
  const startSec = useStore(recording, (s) => s.startSec);
  return (
    <dl className="sheet-times">
      <div>
        <dt>Song</dt>
        <dd>{formatStartTime(position * 1000)}</dd>
      </div>
      <div>
        <dt>Recorded</dt>
        <dd>{formatStartTime(Math.max(0, position - startSec) * 1000)}</dd>
      </div>
    </dl>
  );
}

/** The newest few seconds of the live waveform, drawn on a canvas outside React's render cycle. */
function LiveStrip({ live }: { live: LiveWave }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const count = useSyncExternalStore(
    (fn) => live.subscribe(fn),
    () => live.count,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `count` is what changes the picture
  useEffect(() => {
    const canvas = ref.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      ctx = null; // no canvas support (tests): the sheet still works
    }
    if (!canvas || !ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(canvas).color || '#000';
    const mid = height / 2;
    const blocks = Math.max(1, Math.round(WINDOW_SEC / (live.blockSec || 0.0213)));
    for (const c of tailColumns(live, blocks, width)) {
      const top = mid - Math.min(1, c.max) * mid;
      const bottom = mid - Math.max(-1, c.min) * mid;
      ctx.fillRect(c.x, top, 1, Math.max(1, bottom - top));
    }
  }, [live, count]);

  return (
    <canvas
      ref={ref}
      className="sheet-wave"
      width={640}
      height={96}
      role="img"
      aria-label="Live microphone waveform"
    />
  );
}
