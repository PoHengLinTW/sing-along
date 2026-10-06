import type { ProjectDetail, TrackDto } from '@sing-along/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiRequestError, apiFetch } from '../api/client';
import { replaceTrackAudio, uploadPrepared } from '../api/upload';
import { mixerStore } from '../audio/mixerStore';
import type { DraftView } from '../audio/recorder/draftView';
import { getDraftStore } from '../audio/recorder/storeInstance';
import { uploadDraft } from '../audio/recorder/uploadDraft';
import { useToast } from '../ui/toast';
import { browserUploadDeps } from './UploadPanel';

/**
 * Uploads a draft through the normal pipeline. When the server has it, the new track takes the
 * draft's place: its mix carries over and it is added to the project before the draft is removed,
 * so the take never disappears from the page in between.
 */
export function useDraftUploader(projectId: number) {
  const qc = useQueryClient();
  const toast = useToast();

  return useCallback(
    async (draft: DraftView, onProgress: (fraction: number) => void): Promise<void> => {
      const store = await getDraftStore();
      try {
        await uploadDraft(
          {
            upload: (p) => uploadPrepared(browserUploadDeps, p),
            replace: (p) => replaceTrackAudio(browserUploadDeps, p),
            deleteTrack: (id) => apiFetch(`/api/tracks/${id}`, { method: 'DELETE' }),
            onTracksDeleted: (ids) => {
              for (const id of ids) mixerStore.getState().forget(id);
              qc.setQueryData<ProjectDetail>(['project', String(projectId)], (old) =>
                old ? { ...old, tracks: old.tracks.filter((t) => !ids.includes(t.id)) } : old,
              );
              void qc.invalidateQueries({ queryKey: ['projects'] });
            },
            onDeleteFailed: (ids) =>
              toast.error(
                `Saved, but ${ids.length === 1 ? 'a combined track' : `${ids.length} combined tracks`} could not be deleted. Delete ${ids.length === 1 ? 'it' : 'them'} by hand.`,
              ),
            store,
            onUploaded: (track: TrackDto) => {
              mixerStore.getState().move(draft.engineId, track.id);
              qc.setQueryData<ProjectDetail>(['project', String(projectId)], (old) =>
                old
                  ? {
                      ...old,
                      tracks: [...old.tracks.filter((t) => t.id !== track.id), track].sort(
                        (a, b) => a.sortOrder - b.sortOrder,
                      ),
                    }
                  : old,
              );
              void qc.invalidateQueries({ queryKey: ['projects'] });
              toast.success(
                draft.replacesTrackId === undefined
                  ? `Uploaded '${track.name}'.`
                  : `Saved '${track.name}' over the original.`,
              );
            },
          },
          draft,
          { onProgress },
        );
      } catch (err) {
        // The saved track is gone (someone deleted it): refresh, so the page stops showing it.
        if (
          draft.replacesTrackId !== undefined &&
          err instanceof ApiRequestError &&
          err.status === 404
        ) {
          void qc.invalidateQueries({ queryKey: ['project', String(projectId)] });
        }
        throw err;
      }
    },
    [qc, toast, projectId],
  );
}
