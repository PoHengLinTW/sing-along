import { useState } from 'react';
import { ApiRequestError } from '../api/client';
import { getAudioController } from '../audio/controller';
import { mixerStore } from '../audio/mixerStore';
import type { DraftStore } from '../audio/recorder/draftStore';
import type { DraftView } from '../audio/recorder/draftView';
import { editHistory } from '../audio/recorder/edit/history';
import { selectionStore, useSelection } from '../audio/recorder/edit/selection';
import { savePerformer } from '../audio/recorder/performer';
import { getDraftStore } from '../audio/recorder/storeInstance';
import { latencyForStart, startTimeOf } from '../lib/startTime';
import { LANE_HEIGHT, LANE_MARGIN } from '../timeline/Timeline';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EditableText } from '../ui/EditableText';
import { MixControls } from './MixControls';
import { StartTimeControl } from './StartTimeControl';

interface Props {
  draft: DraftView;
  store?: DraftStore;
  onLatency?: (ms: number) => void;
  /** Uploads the take (progress 0..1); the parent swaps the draft for the new track. */
  onUpload?: (draft: DraftView, onProgress: (fraction: number) => void) => Promise<void>;
}

/** The left-hand controls of a take that has not been uploaded yet. It exists only in this browser. */
type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'error'; message: string; trackGone?: boolean };

export function DraftPanel({ draft, store, onLatency = () => {}, onUpload }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [asking, setAsking] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const uploading = upload.status === 'uploading';
  const replaces = draft.replacesTrackId !== undefined;
  const merged = draft.deletesTrackIds?.length ?? 0;
  const needsAnswer = replaces || merged > 0;

  const startUpload = async () => {
    if (!onUpload || uploading) return;
    setUpload({ status: 'uploading', progress: 0 });
    try {
      await onUpload(draft, (progress) => setUpload({ status: 'uploading', progress }));
      setUpload({ status: 'idle' });
    } catch (err) {
      // A 404 while overwriting means the saved track was deleted since it was checked out.
      const trackGone = replaces && err instanceof ApiRequestError && err.status === 404;
      setUpload({
        status: 'error',
        message: trackGone
          ? `The saved track '${draft.name}' no longer exists: someone may have deleted it.`
          : err instanceof Error
            ? err.message
            : 'The upload failed.',
        trackGone,
      });
    }
  };
  const open = async () => store ?? (await getDraftStore());
  const selected = useSelection((s) => s.ids.includes(draft.id));

  return (
    <div
      className="track-panel draft-panel"
      data-testid={`panel-draft-${draft.id}`}
      style={{ height: LANE_HEIGHT, margin: `${LANE_MARGIN}px 0` }}
    >
      <div className="panel-top">
        <input
          type="checkbox"
          className="edit-select"
          aria-label={`Select ${draft.name} for editing`}
          checked={selected}
          onChange={() => selectionStore.getState().toggle(draft.id)}
        />
        <span className="draft-badge">{replaces ? 'Editing' : 'Draft'}</span>
        <EditableText
          label="Take name"
          labelHidden
          value={draft.name}
          onSave={async (name) => {
            await (await open()).updateDraft(draft.id, { name: name.trim() });
          }}
          validate={(v) => (v.trim() ? null : 'Name is required')}
        />
      </div>
      <EditableText
        label="Performer"
        labelHidden
        value={draft.performer}
        onSave={async (performer) => {
          await (await open()).updateDraft(draft.id, { performer });
          savePerformer(performer); // pre-fills the next take
        }}
        placeholder="Performer"
      />
      <div className="draft-upload">
        {upload.status === 'error' ? (
          <>
            <span role="alert" className="draft-upload-error" title={upload.message}>
              {upload.trackGone ? upload.message : `Upload failed: ${upload.message}`}
            </span>
            {upload.trackGone ? (
              <button
                type="button"
                onClick={async () => {
                  // Cut the link: the take is now an ordinary one and uploads as a new track.
                  await (await open()).updateDraft(draft.id, { replacesTrackId: undefined });
                  setUpload({ status: 'idle' });
                }}
              >
                Save as a new track
              </button>
            ) : (
              <button type="button" onClick={() => void startUpload()}>
                Retry
              </button>
            )}
          </>
        ) : uploading ? (
          <progress aria-label={`Uploading ${draft.name}`} max={1} value={upload.progress} />
        ) : (
          <span className="hint">
            {replaces
              ? 'Editing a saved track: not saved yet'
              : 'Not uploaded: only on this device'}
          </span>
        )}
        {onUpload && upload.status !== 'error' && (
          <button
            type="button"
            aria-label={replaces ? `Save ${draft.name} over the original` : `Upload ${draft.name}`}
            disabled={uploading}
            onClick={() => (needsAnswer ? setAsking(true) : void startUpload())}
          >
            {replaces ? 'Save over original' : 'Upload'}
          </button>
        )}
      </div>
      <MixControls id={draft.engineId}>
        <button
          type="button"
          className="danger"
          aria-label={`Discard ${draft.name}`}
          disabled={uploading}
          onClick={() => setConfirming(true)}
        >
          🗑
        </button>
      </MixControls>
      <StartTimeControl
        value={startTimeOf(draft)}
        home={draft.startOffsetMs}
        onChange={(startMs) => onLatency(latencyForStart(draft, startMs))}
        onPreview={() => void getAudioController().previewAround()}
      />
      <ConfirmDialog
        open={asking}
        title={replaces ? 'Overwrite saved track?' : 'Delete the combined tracks?'}
        message={savingWarning(draft.name, replaces, merged)}
        confirmLabel={replaces ? 'Overwrite' : 'Upload and delete'}
        destructive
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          void startUpload();
        }}
      />
      <ConfirmDialog
        open={confirming}
        title={replaces ? 'Stop editing?' : 'Discard take?'}
        message={
          replaces
            ? `Your edits to '${draft.name}' are thrown away. The saved track is not changed.`
            : `'${draft.name}' exists only on this device. If you discard it, it is gone for good.`
        }
        confirmLabel={replaces ? 'Discard edits' : 'Discard'}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          await (await open()).deleteDraft(draft.id);
          editHistory.forget(draft.id);
          mixerStore.getState().forget(draft.engineId);
        }}
      />
    </div>
  );
}

const savedTracks = (n: number) => `${n} saved track${n === 1 ? '' : 's'}`;

/** What saving this take will do to what is already on the server. */
function savingWarning(name: string, replaces: boolean, merged: number): string {
  if (replaces) {
    const others =
      merged > 0
        ? ` The ${savedTracks(merged).replace('saved ', 'other saved ')} combined into it will be deleted.`
        : '';
    return `This overwrites the saved track '${name}' for everyone with your edited version.${others} It cannot be undone.`;
  }
  return `${savedTracks(merged)} ${merged === 1 ? 'was' : 'were'} combined into '${name}'. When you save it, they will be deleted for everyone. This cannot be undone.`;
}
