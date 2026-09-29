import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { isClipping, levelFraction, toDb } from './level';
import { type LevelStoreState, levelStore } from './levelStore';
import { classifyMicError, loadMicDevice, micErrorMessage } from './mic';
import { getInputMonitor, type InputMonitor } from './monitor';
import { type RecordingState, recordingStore } from './recordingStore';

interface Props {
  levels?: StoreApi<LevelStoreState>;
  recording?: StoreApi<RecordingState>;
  monitor?: Pick<InputMonitor, 'start' | 'stop'>;
}

/** Input level with a clipping warning. Also usable before recording ("Check input level"). */
export function LevelMeter({ levels = levelStore, recording = recordingStore, monitor }: Props) {
  const level = useStore(levels, (s) => s.level);
  const clipUntil = useStore(levels, (s) => s.clipUntil);
  const monitoring = useStore(levels, (s) => s.monitoring);
  const recordingNow = useStore(recording, (s) => s.status !== 'idle');
  const [error, setError] = useState<string | null>(null);
  const [, redraw] = useState(0);

  // The warning ends 2 s after the last clip with no further level updates to trigger a render.
  useEffect(() => {
    const left = clipUntil - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => redraw((n) => n + 1), left);
    return () => clearTimeout(id);
  }, [clipUntil]);

  const toggleCheck = async () => {
    const m = monitor ?? getInputMonitor();
    if (monitoring) return m.stop();
    setError(null);
    try {
      await m.start(loadMicDevice());
    } catch (err) {
      setError(micErrorMessage(classifyMicError(err as { name?: string })));
    }
  };

  const db = toDb(level);
  return (
    <div className="level-meter">
      <meter
        className="meter"
        aria-label="Input level"
        min={0}
        max={1}
        value={levelFraction(level)}
        aria-valuetext={Number.isFinite(db) ? `${Math.round(db)} dB` : 'silent'}
      />
      {isClipping({ level, clipUntil }, Date.now()) && (
        <span className="clip-warning" role="status">
          Clipping: lower your microphone level
        </span>
      )}
      <button type="button" disabled={recordingNow} onClick={() => void toggleCheck()}>
        {monitoring ? 'Stop checking' : 'Check input level'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
