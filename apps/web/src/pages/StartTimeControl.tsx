import { useEffect, useState } from 'react';
import { formatStartTime, NUDGE_COARSE_MS, NUDGE_FINE_MS, parseStartTime } from '../lib/startTime';

interface Props {
  /** Where the track begins on the song timeline, in ms. */
  value: number;
  /** The start the track was placed at originally: what "reset" returns to. */
  home: number;
  onChange: (startMs: number) => void;
  /** Loop the 4 s around the playhead so the alignment can be judged by ear. */
  onPreview?: () => void;
}

const NUDGES = [
  { label: 'Start 100 ms earlier', text: '−100', delta: -NUDGE_COARSE_MS },
  { label: 'Start 10 ms earlier', text: '−10', delta: -NUDGE_FINE_MS },
  { label: 'Start 10 ms later', text: '+10', delta: NUDGE_FINE_MS },
  { label: 'Start 100 ms later', text: '+100', delta: NUDGE_COARSE_MS },
];

/** Start time of one track or draft: exact entry, nudges, reset and a preview loop. */
export function StartTimeControl({ value, home, onChange, onPreview }: Props) {
  const [text, setText] = useState(formatStartTime(value));
  const [editing, setEditing] = useState(false);
  const invalid = editing && parseStartTime(text) === null;

  useEffect(() => {
    if (!editing) setText(formatStartTime(value));
  }, [value, editing]);

  const commit = () => {
    const parsed = parseStartTime(text);
    setEditing(false);
    if (parsed === null) setText(formatStartTime(value));
    else if (parsed !== value) onChange(parsed);
    else setText(formatStartTime(value));
  };

  return (
    <div className="panel-start">
      <span className="hint">Start</span>
      {NUDGES.slice(0, 2).map((n) => (
        <button
          key={n.label}
          type="button"
          aria-label={n.label}
          onClick={() => onChange(value + n.delta)}
        >
          {n.text}
        </button>
      ))}
      <input
        type="text"
        className="start-time"
        aria-label="Start time"
        aria-invalid={invalid}
        inputMode="decimal"
        spellCheck={false}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = e.shiftKey ? NUDGE_COARSE_MS : NUDGE_FINE_MS;
            onChange(value + (e.key === 'ArrowUp' ? step : -step));
          } else if (e.key === 'Escape') {
            setEditing(false);
            setText(formatStartTime(value));
          }
        }}
      />
      {NUDGES.slice(2).map((n) => (
        <button
          key={n.label}
          type="button"
          aria-label={n.label}
          onClick={() => onChange(value + n.delta)}
        >
          {n.text}
        </button>
      ))}
      <button
        type="button"
        aria-label="Reset start time"
        title={`Back to ${formatStartTime(home)}`}
        disabled={value === home}
        onClick={() => onChange(home)}
      >
        ⟲
      </button>
      {onPreview && (
        <button
          type="button"
          aria-label="Loop around here"
          title="Play the 4 s around the playhead on repeat, to judge the alignment"
          onClick={onPreview}
        >
          ↻ 4 s
        </button>
      )}
    </div>
  );
}
