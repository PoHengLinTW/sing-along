import { useEffect, useState } from 'react';
import { clampLatency, LATENCY_MAX_MS } from '../audio/latency';

interface Props {
  /** Milliseconds; negative plays the track earlier. */
  value: number;
  onChange: (ms: number) => void;
  /** Loop the 4 s around the playhead so the alignment can be judged by ear. */
  onPreview?: () => void;
}

const KEY_DIRECTION: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

/** Latency offset for one track or draft: slider (1 ms steps), exact entry, reset, preview. */
export function LatencyControl({ value, onChange, onPreview }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  return (
    <div className="panel-latency">
      <input
        type="range"
        aria-label="Latency offset"
        min={-LATENCY_MAX_MS}
        max={LATENCY_MAX_MS}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => {
          const direction = KEY_DIRECTION[e.key];
          if (!direction) return;
          e.preventDefault(); // one consistent step size, whatever the browser's own arrow handling
          onChange(clampLatency(value + direction * (e.shiftKey ? 10 : 1)));
        }}
      />
      <input
        type="number"
        className="latency-number"
        aria-label="Latency offset (ms)"
        min={-LATENCY_MAX_MS}
        max={LATENCY_MAX_MS}
        step={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // A half-typed value ("-", "") is not a number yet: wait rather than jump to 0.
          if (/^-?\d+$/.test(e.target.value.trim())) onChange(clampLatency(Number(e.target.value)));
        }}
        onBlur={() => setText(String(value))}
      />
      <span className="hint">ms</span>
      <button
        type="button"
        aria-label="Reset latency offset"
        title="Back to 0 ms"
        disabled={value === 0}
        onClick={() => onChange(0)}
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
