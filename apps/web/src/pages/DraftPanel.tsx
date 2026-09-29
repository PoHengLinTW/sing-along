import { useState } from 'react';
import { getAudioController } from '../audio/controller';
import { mixerStore } from '../audio/mixerStore';
import type { DraftStore } from '../audio/recorder/draftStore';
import type { DraftView } from '../audio/recorder/draftView';
import { savePerformer } from '../audio/recorder/performer';
import { getDraftStore } from '../audio/recorder/storeInstance';
import { LANE_HEIGHT, LANE_MARGIN } from '../timeline/Timeline';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EditableText } from '../ui/EditableText';
import { LatencyControl } from './LatencyControl';
import { MixControls } from './MixControls';

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
  | { status: 'error'; message: string };

export function DraftPanel({ draft, store, onLatency = () => {}, onUpload }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const uploading = upload.status === 'uploading';

  const startUpload = async () => {
    if (!onUpload || uploading) return;
    setUpload({ status: 'uploading', progress: 0 });
    try {
      await onUpload(draft, (progress) => setUpload({ status: 'uploading', progress }));
      setUpload({ status: 'idle' });
    } catch (err) {
      setUpload({
        status: 'error',
        message: err instanceof Error ? err.message : 'The upload failed.',
      });
    }
  };
  const open = async () => store ?? (await getDraftStore());

  return (
    <div
      className="track-panel draft-panel"
      data-testid={`panel-draft-${draft.id}`}
      style={{ height: LANE_HEIGHT, margin: `${LANE_MARGIN}px 0` }}
    >
      <div className="panel-top">
        <span className="draft-badge">Draft</span>
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
              Upload failed: {upload.message}
            </span>
            <button type="button" onClick={() => void startUpload()}>
              Retry
            </button>
          </>
        ) : uploading ? (
          <progress aria-label={`Uploading ${draft.name}`} max={1} value={upload.progress} />
        ) : (
          <span className="hint">Not uploaded: only on this device</span>
        )}
        {onUpload && upload.status !== 'error' && (
          <button
            type="button"
            aria-label={`Upload ${draft.name}`}
            disabled={uploading}
            onClick={() => void startUpload()}
          >
            Upload
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
      <LatencyControl
        value={draft.latencyOffsetMs}
        onChange={onLatency}
        onPreview={() => void getAudioController().previewAround()}
      />
      <ConfirmDialog
        open={confirming}
        title="Discard take?"
        message={`'${draft.name}' exists only on this device. If you discard it, it is gone for good.`}
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          await (await open()).deleteDraft(draft.id);
          mixerStore.getState().forget(draft.engineId);
        }}
      />
    </div>
  );
}
