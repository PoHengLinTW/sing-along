import { type RefObject, useEffect, useRef } from 'react';
import { type LiveWave, liveColumns } from '../audio/recorder/liveWave';

interface Props {
  wave: LiveWave;
  pxPerSec: number;
  /** The horizontally scrolling element: the canvas only covers what is visible in it. */
  scroller: RefObject<HTMLElement | null>;
  height: number;
  color: string;
}

/**
 * Live waveform of the take being recorded. A take can be 10 minutes long (60 000 px at the default
 * zoom, past canvas size limits), so the canvas is only as wide as the viewport, sticks to its left
 * edge, and is redrawn for the visible part on every frame that brought new audio.
 */
export function RecordingLane({ wave, pxPerSec, scroller, height, color }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame: number | null = null;

    const draw = () => {
      frame = null;
      const el = canvas.current;
      const host = scroller.current;
      if (!el || !host) return;
      const width = host.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      const g = el.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      if (!wave.timed) return;
      g.fillStyle = color;
      const mid = height / 2;
      for (const col of liveColumns(
        wave,
        wave.blockSec,
        wave.startSec,
        pxPerSec,
        host.scrollLeft,
        width,
      )) {
        const top = mid - col.max * mid;
        const bottom = mid - col.min * mid;
        g.fillRect(col.x, top, 1, Math.max(1, bottom - top));
      }
    };

    // Updates arrive ~45 times a second: one draw per animation frame is enough and never more.
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(draw);
    };
    const unsubscribe = wave.subscribe(schedule);
    const host = scroller.current;
    host?.addEventListener('scroll', schedule);
    schedule();
    return () => {
      unsubscribe();
      host?.removeEventListener('scroll', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [wave, pxPerSec, scroller, height, color]);

  return (
    <canvas
      ref={canvas}
      className="recording-canvas"
      aria-label="Live recording waveform"
      style={{ height }}
    />
  );
}
