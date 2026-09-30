import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { formatClock, formatTransportTime } from '../timeline/math';
import { type AudioController, getAudioController } from './controller';
import { RecordControls } from './recorder/RecordControls';
import { type RecordingState, recordingStore } from './recorder/recordingStore';
import { transportShortcut } from './shortcuts';
import { type TransportState, transportStore } from './transportStore';

type Controls = Pick<
  AudioController,
  'toggle' | 'restart' | 'skip' | 'setLoopPoint' | 'toggleLoop' | 'clearLoop'
>;

interface Props {
  controller?: Controls;
  transport?: StoreApi<TransportState>;
  recording?: StoreApi<RecordingState>;
  /** When set, the bar shows the Record button for this project. */
  projectId?: number;
}

const LOCKED_TITLE = 'Unavailable while recording';

const SKIP_SEC = 10;

export function TransportBar({
  controller,
  transport = transportStore,
  recording = recordingStore,
  projectId,
}: Props) {
  const ctl = controller ?? getAudioController();
  const playing = useStore(transport, (s) => s.playing);
  const locked = useStore(recording, (s) => s.status !== 'idle');
  const lockTitle = (title: string) => (locked ? LOCKED_TITLE : title);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = transportShortcut(e);
      if (!action || recording.getState().status !== 'idle') return;
      e.preventDefault(); // Space would otherwise scroll the page
      if (action === 'toggle') void ctl.toggle();
      else if (action === 'restart') ctl.restart();
      else ctl.skip(action === 'back' ? -SKIP_SEC : SKIP_SEC);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ctl, recording]);

  return (
    <div className="transport" role="toolbar" aria-label="Transport">
      <button
        type="button"
        aria-label="Restart"
        disabled={locked}
        title={lockTitle('Restart (Home)')}
        onClick={() => ctl.restart()}
      >
        ↶
      </button>
      <button
        type="button"
        aria-label="Back 10 seconds"
        disabled={locked}
        title={lockTitle('Back 10 s (←)')}
        onClick={() => ctl.skip(-SKIP_SEC)}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={locked}
        title={lockTitle('Play / Pause (Space)')}
        className="play"
        onClick={() => void ctl.toggle()}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button
        type="button"
        aria-label="Forward 10 seconds"
        disabled={locked}
        title={lockTitle('Forward 10 s (→)')}
        onClick={() => ctl.skip(SKIP_SEC)}
      >
        ›
      </button>
      <TimeDisplay transport={transport} />
      <LoopControls controller={ctl} transport={transport} locked={locked} />
      {projectId !== undefined && <RecordControls projectId={projectId} recording={recording} />}
    </div>
  );
}

function LoopControls({
  controller,
  transport,
  locked,
}: {
  controller: Controls;
  transport: StoreApi<TransportState>;
  locked: boolean;
}) {
  const lockTitle = (title: string) => (locked ? LOCKED_TITLE : title);
  const loop = useStore(transport, (s) => s.loop);
  const loopEnabled = useStore(transport, (s) => s.loopEnabled);
  const loopA = useStore(transport, (s) => s.loopA);
  const range = loop
    ? `A ${formatClock(loop.a)} – B ${formatClock(loop.b)}`
    : loopA !== null
      ? `A ${formatClock(loopA)} – B ?`
      : null;

  return (
    <fieldset className="loop-controls" aria-label="A–B loop">
      <button
        type="button"
        aria-label="Set loop start (A)"
        disabled={locked}
        title={lockTitle('Set loop start (A) at the playhead')}
        onClick={() => controller.setLoopPoint('a')}
      >
        Set A
      </button>
      <button
        type="button"
        aria-label="Set loop end (B)"
        disabled={locked}
        title={lockTitle('Set loop end (B) at the playhead')}
        onClick={() => controller.setLoopPoint('b')}
      >
        Set B
      </button>
      <button
        type="button"
        aria-label="Loop"
        aria-pressed={loopEnabled}
        disabled={locked || !loop}
        title={lockTitle('Loop between A and B')}
        onClick={() => controller.toggleLoop()}
      >
        ↻
      </button>
      <button
        type="button"
        aria-label="Clear loop"
        disabled={locked || (!loop && loopA === null)}
        title={lockTitle('Clear the loop')}
        onClick={() => controller.clearLoop()}
      >
        ×
      </button>
      {range && (
        <span className="loop-range" data-testid="loop-range">
          {range}
        </span>
      )}
    </fieldset>
  );
}

/** The only per-frame React reader of the position: kept tiny so the rest of the bar never re-renders. */
function TimeDisplay({ transport }: { transport: StoreApi<TransportState> }) {
  const position = useStore(transport, (s) => s.position);
  const duration = useStore(transport, (s) => s.duration);
  return (
    <span className="time" data-testid="time" aria-live="off">
      {formatTransportTime(position, duration)}
    </span>
  );
}
