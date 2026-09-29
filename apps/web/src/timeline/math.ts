export const MIN_PX_PER_SEC = 2;
export const MAX_PX_PER_SEC = 800;
export const DEFAULT_PX_PER_SEC = 50;
const MIN_TICK_SPACING_PX = 80;
const STEPS_SEC = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

export const secToPx = (sec: number, pxPerSec: number) => sec * pxPerSec;
export const pxToSec = (px: number, pxPerSec: number) => Math.max(0, px / pxPerSec);

const pad2 = (n: number) => String(n).padStart(2, '0');

/** m:ss (minutes are not capped at 59). */
export function formatClock(sec: number): string {
  const whole = Math.floor(sec);
  return `${Math.floor(whole / 60)}:${pad2(whole % 60)}`;
}

/** "mm:ss.s / mm:ss": tenths for the position, whole seconds for the total. */
export function formatTransportTime(positionSec: number, durationSec: number): string {
  const tenths = Math.floor(positionSec * 10);
  const s = Math.floor(tenths / 10);
  const total = Math.floor(durationSec);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}.${tenths % 10} / ${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export const clampZoom = (pxPerSec: number) =>
  Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, pxPerSec));
export const zoomBy = (pxPerSec: number, factor: number) => clampZoom(pxPerSec * factor);

export interface Tick {
  sec: number;
  px: number;
  label: string;
}

/** mm:ss marks whose spacing adapts to the zoom: the smallest step that keeps labels >= 80 px apart. */
export function rulerTicks(o: { pxPerSec: number; fromSec: number; toSec: number }): {
  stepSec: number;
  ticks: Tick[];
} {
  const stepSec =
    STEPS_SEC.find((s) => s * o.pxPerSec >= MIN_TICK_SPACING_PX) ??
    STEPS_SEC[STEPS_SEC.length - 1] ??
    1;
  const ticks: Tick[] = [];
  const first = Math.ceil(o.fromSec / stepSec - 1e-9);
  for (let i = first; i * stepSec <= o.toSec + 1e-9; i++) {
    const sec = Math.round(i * stepSec * 1000) / 1000 + 0; // + 0 turns -0 into 0
    const frac = stepSec < 1 ? `.${Math.round((sec % 1) * 10)}` : '';
    ticks.push({ sec, px: secToPx(sec, o.pxPerSec), label: formatClock(sec) + frac });
  }
  return { stepSec, ticks };
}

/**
 * Auto-follow: keep the playhead in view while playing. When it passes 90% of the viewport (or is
 * left of it) the view pages so the playhead sits 10% from the left edge.
 */
export function followScrollLeft(o: {
  scrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  playheadPx: number;
}): number {
  const maxScroll = Math.max(0, o.contentWidth - o.viewportWidth);
  const inView =
    o.playheadPx >= o.scrollLeft && o.playheadPx <= o.scrollLeft + o.viewportWidth * 0.9;
  const target = inView ? o.scrollLeft : o.playheadPx - o.viewportWidth * 0.1;
  return Math.min(maxScroll, Math.max(0, target));
}
