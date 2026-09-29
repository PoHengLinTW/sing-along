import type { ProjectDetail, TrackDto } from '@sing-along/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '../api/client';
import {
  applyLatency,
  clampLatency,
  convergedIds,
  LATENCY_SAVE_DELAY_MS,
  latencyStore,
  useLatencyOverrides,
} from '../audio/latency';
import type { DraftView } from '../audio/recorder/draftView';
import { getDraftStore } from '../audio/recorder/storeInstance';
import { KeyedDebouncer } from '../lib/debounce';
import { useToast } from '../ui/toast';

/**
 * Live latency editing for a project's tracks and drafts. Returns the lists with the offsets being
 * edited applied (so lane, engine and panel move at once) and the setters, which save after
 * `LATENCY_SAVE_DELAY_MS` without further edits: a PATCH for a track, IndexedDB for a draft.
 * A failed save reverts the offset and says so. Leaving the page saves what is pending.
 */
export function useLatencyEditing(projectId: number, tracks: TrackDto[], drafts: DraftView[]) {
  const qc = useQueryClient();
  const toast = useToast();
  const overrides = useLatencyOverrides();
  const debouncer = useRef(new KeyedDebouncer(LATENCY_SAVE_DELAY_MS));

  useEffect(() => {
    const d = debouncer.current;
    return () => d.flushAll();
  }, []);

  const effectiveTracks = useMemo(
    () => applyLatency(tracks, (t) => t.id, overrides),
    [tracks, overrides],
  );
  const effectiveDrafts = useMemo(
    () => applyLatency(drafts, (d) => d.engineId, overrides),
    [drafts, overrides],
  );

  // Once the saved data shows the value, the pending copy has done its job.
  useEffect(() => {
    const ids = [
      ...convergedIds(tracks, (t) => t.id, overrides),
      ...convergedIds(drafts, (d) => d.engineId, overrides),
    ];
    if (ids.length > 0) latencyStore.getState().drop(ids);
  }, [tracks, drafts, overrides]);

  const failed = useCallback(
    (id: number) => {
      latencyStore.getState().drop([id]); // back to the saved value
      toast.error("Couldn't save the latency offset. It was put back to its saved value.");
    },
    [toast],
  );

  const setTrackLatency = useCallback(
    (track: TrackDto, ms: number) => {
      const value = clampLatency(ms);
      latencyStore.getState().set(track.id, value);
      debouncer.current.schedule(track.id, () => {
        apiFetch<TrackDto>(`/api/tracks/${track.id}`, {
          method: 'PATCH',
          body: { latencyOffsetMs: value },
        }).then(
          () =>
            qc.setQueryData<ProjectDetail>(['project', String(projectId)], (old) =>
              old
                ? {
                    ...old,
                    tracks: old.tracks.map((t) =>
                      t.id === track.id ? { ...t, latencyOffsetMs: value } : t,
                    ),
                  }
                : old,
            ),
          () => failed(track.id),
        );
      });
    },
    [qc, projectId, failed],
  );

  const setDraftLatency = useCallback(
    (draft: DraftView, ms: number) => {
      const value = clampLatency(ms);
      latencyStore.getState().set(draft.engineId, value);
      debouncer.current.schedule(draft.engineId, () => {
        getDraftStore()
          .then((store) => store.updateDraft(draft.id, { latencyOffsetMs: value }))
          .catch(() => failed(draft.engineId));
      });
    },
    [failed],
  );

  return { tracks: effectiveTracks, drafts: effectiveDrafts, setTrackLatency, setDraftLatency };
}
