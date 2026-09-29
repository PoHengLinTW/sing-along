import { clampZoom } from '../timeline/math';
import { MAX_VOLUME, type TrackMix } from './mixerStore';

/** What one browser remembers about one project: the mix and the zoom. Never sent to the server. */
export interface SavedMix {
  byId: Record<number, TrackMix>;
  pxPerSec: number | null;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const mixKey = (projectId: number) => `sing-along:mix:${projectId}`;

const EMPTY: SavedMix = { byId: {}, pxPerSec: null };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Tolerant reader: anything unexpected falls back to defaults instead of breaking the page. */
export function parseMix(json: string | null): SavedMix {
  if (!json) return { ...EMPTY, byId: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...EMPTY, byId: {} };
  }
  if (!isRecord(raw) || !isRecord(raw.byId)) return { ...EMPTY, byId: {} };

  const byId: Record<number, TrackMix> = {};
  for (const [key, value] of Object.entries(raw.byId)) {
    if (!/^\d+$/.test(key) || !isRecord(value)) continue;
    const volume =
      typeof value.volume === 'number' && Number.isFinite(value.volume) ? value.volume : 1;
    byId[Number(key)] = {
      volume: Math.min(MAX_VOLUME, Math.max(0, volume)),
      muted: value.muted === true,
      solo: value.solo === true,
    };
  }
  const zoom = raw.pxPerSec;
  return {
    byId,
    pxPerSec: typeof zoom === 'number' && Number.isFinite(zoom) ? clampZoom(zoom) : null,
  };
}

/** Drops the state of tracks that no longer exist. Returns the same object when nothing changed. */
export function pruneMix(
  byId: Record<number, TrackMix>,
  trackIds: number[],
): Record<number, TrackMix> {
  const valid = new Set(trackIds);
  const keys = Object.keys(byId).map(Number);
  if (keys.every((k) => valid.has(k))) return byId;
  return Object.fromEntries(keys.filter((k) => valid.has(k)).map((k) => [k, byId[k] as TrackMix]));
}

export function loadMix(storage: KeyValueStorage | null, projectId: number): SavedMix {
  try {
    return parseMix(storage?.getItem(mixKey(projectId)) ?? null);
  } catch {
    return { ...EMPTY, byId: {} }; // storage blocked
  }
}

export function saveMix(storage: KeyValueStorage | null, projectId: number, mix: SavedMix): void {
  try {
    storage?.setItem(mixKey(projectId), JSON.stringify(mix));
  } catch {
    /* private mode or quota: the mix simply isn't remembered */
  }
}
