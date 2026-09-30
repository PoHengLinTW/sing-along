import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface Props {
  peaks: number[];
  durationSec: number;
  pxPerSec: number;
  color: string;
  height: number;
}

/**
 * Draws a waveform from precomputed peaks: wavesurfer never fetches or decodes audio (M0-07).
 * Playback is entirely ours; wavesurfer is only a renderer here.
 */
export function Waveform({ peaks, durationSec, pxPerSec, color, height }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: created once per track data; zoom and color update below
  useEffect(() => {
    if (!host.current) return;
    ws.current = WaveSurfer.create({
      container: host.current,
      peaks: [Float32Array.from(peaks)],
      duration: durationSec,
      height,
      waveColor: color,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      minPxPerSec: pxPerSec,
      interact: false,
      hideScrollbar: true,
      cursorWidth: 0,
    });
    return () => {
      ws.current?.destroy();
      ws.current = null;
    };
  }, [peaks, durationSec, height]);

  useEffect(() => {
    // setOptions, not zoom(): zoom() needs decoded audio and throws in peaks-only mode
    ws.current?.setOptions({ minPxPerSec: pxPerSec, waveColor: color });
  }, [pxPerSec, color]);

  return <div ref={host} className="waveform" />;
}
