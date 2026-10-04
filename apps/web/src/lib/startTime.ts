import { OFFSET_MAX_MS } from '@sing-along/shared';

export const NUDGE_FINE_MS = 10;
export const NUDGE_COARSE_MS = 100;

/**
 * Where a track begins on the song timeline. The data keeps two offsets (the song offset and the
 * device latency); users see only their sum, so that is what they edit.
 */
export function startTimeOf(t: { startOffsetMs: number; latencyOffsetMs: number }): number {
  return t.startOffsetMs + t.latencyOffsetMs;
}

/** The latency offset that puts the track at `startMs`; the song offset stays as it is. */
export function latencyForStart(
  t: { startOffsetMs: number; latencyOffsetMs?: number },
  startMs: number,
): number {
  const latency = Math.round(startMs) - t.startOffsetMs;
  return Math.max(-OFFSET_MAX_MS, Math.min(OFFSET_MAX_MS, latency));
}

/** "00:12.350"; a start before zero gets a minus sign. */
export function formatStartTime(ms: number): string {
  const total = Math.round(ms);
  const abs = Math.abs(total);
  const m = Math.floor(abs / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const milli = abs % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${total < 0 ? '-' : ''}${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
}

const PATTERN = /^(-)?(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/;

/** Reads "mm:ss.mmm", "ss.mmm", "m:ss" or plain seconds. Null when it is not a time. */
export function parseStartTime(text: string): number | null {
  const m = PATTERN.exec(text.trim());
  if (!m) return null;
  const [, sign, min, sec, frac] = m;
  const seconds = Number(sec);
  if (min !== undefined && seconds >= 60) return null;
  const ms = Number(min ?? 0) * 60_000 + seconds * 1000 + Number((frac ?? '').padEnd(3, '0'));
  return sign ? -ms : ms;
}
