import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { formatClock, formatTransportTime } from '../timeline/math';
import { type AudioController, getAudioController } from './controller';
import { transportShortcut } from './shortcuts';
import { type TransportState, transportStore } from './transportStore';

type Controls = Pick<
  AudioController,
  'toggle' | 'restart' | 'skip' | 'setLoopPoint' | 'toggleLoop' | 'clearLoop'
>;

interface Props {
  controller?: Controls;
  transport?: StoreApi<TransportState>;
}

const SKIP_SEC = 10;

export function TransportBar({ controller, transport = transportStore }: Props) {
  const ctl = controller ?? getAudioController();
  const playing = useStore(transport, (s) => s.playing);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = transportShortcut(e);
      if (!action) return;
      e.preventDefault(); // Space would otherwise scroll the page
      if (action === 'toggle') void ctl.toggle();
      else if (action === 'restart') ctl.restart();
      else ctl.skip(action === 'back' ? -SKIP_SEC : SKIP_SEC);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ctl]);

  return (
    <div className="transport" role="toolbar" aria-label="Transport">
      <button
        type="button"
        aria-label="Restart"
        title="Restart (Home)"
        onClick={() => ctl.restart()}
      >
        ⏮
      </button>
      <button
        type="button"
        aria-label="Back 10 seconds"
        title="Back 10 s (←)"
        onClick={() => ctl.skip(-SKIP_SEC)}
      >
        ⏪
      </button>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        title="Play / Pause (Space)"
        className="play"
        onClick={() => void ctl.toggle()}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button
        type="button"
        aria-label="Forward 10 seconds"
        title="Forward 10 s (→)"
        onClick={() => ctl.skip(SKIP_SEC)}
      >
        ⏩
      </button>
      <TimeDisplay transport={transport} />
      <LoopControls controller={ctl} transport={transport} />
    </div>
  );
}

function LoopControls({
  controller,
  transport,
}: {
  controller: Controls;
  transport: StoreApi<TransportState>;
}) {
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
        title="Set loop start (A) at the playhead"
        onClick={() => controller.setLoopPoint('a')}
      >
        Set A
      </button>
      <button
        type="button"
        aria-label="Set loop end (B)"
        title="Set loop end (B) at the playhead"
        onClick={() => controller.setLoopPoint('b')}
      >
        Set B
      </button>
      <button
        type="button"
        aria-label="Loop"
        aria-pressed={loopEnabled}
        disabled={!loop}
        title="Loop between A and B"
        onClick={() => controller.toggleLoop()}
      >
        🔁
      </button>
      <button
        type="button"
        aria-label="Clear loop"
        disabled={!loop && loopA === null}
        title="Clear the loop"
        onClick={() => controller.clearLoop()}
      >
        ✕
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
