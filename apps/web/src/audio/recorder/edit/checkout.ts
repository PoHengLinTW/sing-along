import type { AudioUrlResponse, TrackDto } from '@sing-along/shared';
import { apiFetch } from '../../../api/client';
import { getAudioController } from '../../controller';
import { mixerStore } from '../../mixerStore';
import type { Draft, DraftStore } from '../draftStore';
import { draftEngineId } from '../draftView';
import { getDraftStore } from '../storeInstance';

interface Deps {
  getStore: () => Promise<DraftStore>;
  /** The saved track's audio file. */
  download: (trackId: number) => Promise<Blob>;
  sampleRate: number;
  copyMix: (fromTrackId: number, toEngineId: number) => void;
}

/**
 * Checks a saved track out for editing: a local take with the same audio, placement, name and
 * labels, linked to the track. Everything the editor can do to a take then works on it, and saving
 * it overwrites the saved track; discarding it leaves the track untouched. Checking the same track
 * out again returns the take already made.
 */
export async function checkOutTrack(deps: Deps, track: TrackDto): Promise<Draft> {
  const store = await deps.getStore();
  const existing = await store.listDrafts(track.projectId);
  const already = existing.find((d) => d.replacesTrackId === track.id);
  if (already) return already;

  const blob = await deps.download(track.id);
  const draft: Draft = {
    id: crypto.randomUUID(),
    projectId: track.projectId,
    startOffsetMs: track.startOffsetMs,
    latencyOffsetMs: track.latencyOffsetMs,
    sampleRate: deps.sampleRate,
    // Strictly after the others, so it lists last like a new take.
    createdAt: Math.max(Date.now(), ...existing.map((d) => d.createdAt + 1)),
    status: 'ready',
    name: track.name,
    performer: track.performer ?? '',
    blob,
    mimeType: track.mimeType,
    peaks: track.peaks,
    durationMs: track.durationMs,
    labelIds: track.labels.map((l) => l.id),
    replacesTrackId: track.id,
  };
  await store.replaceDrafts([], [draft]);
  deps.copyMix(track.id, draftEngineId(draft.id));
  return draft;
}

export const checkOutSavedTrack = (track: TrackDto): Promise<Draft> =>
  checkOutTrack(
    {
      getStore: getDraftStore,
      download: async (trackId) => {
        const { url } = await apiFetch<AudioUrlResponse>(`/api/tracks/${trackId}/audio-url`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Audio download failed (${res.status})`);
        return res.blob();
      },
      sampleRate: getAudioController().engine.ensureContext().sampleRate,
      copyMix: (from, to) => mixerStore.getState().copy(from, to),
    },
    track,
  );
