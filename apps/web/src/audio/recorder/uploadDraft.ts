import type { TrackDto } from '@sing-along/shared';
import type { PreparedUpload, ReplaceParams } from '../../api/upload';
import type { DraftStore } from './draftStore';
import type { DraftView } from './draftView';
import { editHistory } from './edit/history';

interface Deps {
  upload: (p: PreparedUpload) => Promise<TrackDto>;
  /** Overwrites a saved track's audio: used for a draft that was checked out for editing. */
  replace?: (p: ReplaceParams) => Promise<TrackDto>;
  deleteTrack?: (trackId: number) => Promise<void>;
  /** Saved tracks that were merged into this take and are now gone from the server. */
  onTracksDeleted?: (trackIds: number[]) => void;
  /** Merged tracks that could not be removed: the save itself went through. */
  onDeleteFailed?: (trackIds: number[]) => void;
  store: Pick<DraftStore, 'deleteDraft'>;
  /** Runs once the server has the track, before the local draft is removed (swap it into the UI). */
  onUploaded?: (track: TrackDto) => void;
}

/**
 * Uploads a draft as a recorded track. The draft is deleted only after the server confirmed the
 * upload, so a failure, a closed tab or a reload at any earlier point leaves it to try again. The
 * offsets and name are the ones on screen (they may not have reached IndexedDB yet).
 */
export async function uploadDraft(
  deps: Deps,
  draft: DraftView,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<TrackDto> {
  const form = { name: draft.name, performer: draft.performer, labelIds: draft.labelIds ?? [] };
  const track =
    draft.replacesTrackId !== undefined && deps.replace
      ? await deps.replace({
          trackId: draft.replacesTrackId,
          blob: draft.blob,
          mimeType: draft.mimeType,
          durationMs: draft.durationMs,
          peaks: draft.peaks,
          startOffsetMs: draft.startOffsetMs,
          latencyOffsetMs: draft.latencyOffsetMs,
          form,
          onProgress: opts.onProgress,
          signal: opts.signal,
        })
      : await deps.upload({
          projectId: draft.projectId,
          blob: draft.blob,
          mimeType: draft.mimeType,
          durationMs: draft.durationMs,
          peaks: draft.peaks,
          startOffsetMs: draft.startOffsetMs,
          latencyOffsetMs: draft.latencyOffsetMs,
          source: 'recording',
          form,
          onProgress: opts.onProgress,
          signal: opts.signal,
        });
  deps.onUploaded?.(track);
  editHistory.forget(draft.id); // undo must not bring an uploaded take back
  await removeMerged(deps, draft.deletesTrackIds ?? []);
  try {
    await deps.store.deleteDraft(draft.id);
  } catch {
    // The take is safely on the server; a leftover local copy can be discarded by hand.
  }
  return track;
}

/** Deletes the saved tracks that were merged into the take, one by one, and says how it went. */
async function removeMerged(
  deps: Pick<Deps, 'deleteTrack' | 'onTracksDeleted' | 'onDeleteFailed'>,
  ids: number[],
): Promise<void> {
  if (!ids.length || !deps.deleteTrack) return;
  const gone: number[] = [];
  const failed: number[] = [];
  for (const id of ids) {
    try {
      await deps.deleteTrack(id);
      gone.push(id);
    } catch {
      failed.push(id);
    }
  }
  if (gone.length) deps.onTracksDeleted?.(gone);
  if (failed.length) deps.onDeleteFailed?.(failed);
}
