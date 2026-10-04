import type { TrackDto } from '@sing-along/shared';
import type { PreparedUpload } from '../../api/upload';
import type { DraftStore } from './draftStore';
import type { DraftView } from './draftView';
import { editHistory } from './edit/history';

interface Deps {
  upload: (p: PreparedUpload) => Promise<TrackDto>;
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
  const track = await deps.upload({
    projectId: draft.projectId,
    blob: draft.blob,
    mimeType: draft.mimeType,
    durationMs: draft.durationMs,
    peaks: draft.peaks,
    startOffsetMs: draft.startOffsetMs,
    latencyOffsetMs: draft.latencyOffsetMs,
    source: 'recording',
    form: { name: draft.name, performer: draft.performer, labelIds: draft.labelIds ?? [] },
    onProgress: opts.onProgress,
    signal: opts.signal,
  });
  deps.onUploaded?.(track);
  editHistory.forget(draft.id); // undo must not bring an uploaded take back
  try {
    await deps.store.deleteDraft(draft.id);
  } catch {
    // The take is safely on the server; a leftover local copy can be discarded by hand.
  }
  return track;
}
