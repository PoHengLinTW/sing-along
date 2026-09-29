import type { Draft } from './draftStore';

/**
 * The engine, mixer and mix persistence are keyed by numeric track id. A draft gets a stable
 * negative one derived from its UUID: it never clashes with a server id (always positive), and
 * because it is derived, not counted, the same draft keeps its remembered mix after a reload.
 */
export function draftEngineId(draftId: string): number {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < draftId.length; i++) {
    h ^= draftId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return -(1 + ((h >>> 0) % 0x3fffffff));
}

/** A ready draft, shaped for the lane, the panel and the engine. */
export interface DraftView {
  id: string;
  engineId: number;
  name: string;
  performer: string;
  startOffsetMs: number;
  latencyOffsetMs: number;
  durationMs: number;
  peaks: number[];
  blob: Blob;
}

/** Null while the take is still recording or encoding: only an encoded draft can be played. */
export function toDraftView(d: Draft): DraftView | null {
  if (d.status !== 'ready' || !d.blob || !d.peaks || d.durationMs === undefined) return null;
  return {
    id: d.id,
    engineId: draftEngineId(d.id),
    name: d.name,
    performer: d.performer,
    startOffsetMs: d.startOffsetMs,
    latencyOffsetMs: d.latencyOffsetMs,
    durationMs: d.durationMs,
    peaks: d.peaks,
    blob: d.blob,
  };
}
