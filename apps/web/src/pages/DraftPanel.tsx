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
}

/** The left-hand controls of a take that has not been uploaded yet. It exists only in this browser. */
export function DraftPanel({ draft, store, onLatency = () => {} }: Props) {
  const [confirming, setConfirming] = useState(false);
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
      <span className="hint">Not uploaded: only on this device</span>
      <MixControls id={draft.engineId}>
        <button
          type="button"
          className="danger"
          aria-label={`Discard ${draft.name}`}
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
