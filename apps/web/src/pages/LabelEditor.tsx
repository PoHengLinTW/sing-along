import type { TrackDto } from '@sing-along/shared';
import { useId, useState } from 'react';
import { apiFetch } from '../api/client';
import { useLabels } from '../lib/useLabels';
import { LabelPicker } from '../ui/LabelPicker';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  track: TrackDto;
  onClose: () => void;
  onSaved: (updated: TrackDto) => void;
}

/** Edit a track's labels in a dialog; the selection is saved once, with Done. */
export function LabelEditor({ open, track, onClose, onSaved }: Props) {
  const titleId = useId();
  return (
    <Modal open={open} labelledBy={titleId} onCancel={onClose}>
      <LabelEditorBody titleId={titleId} track={track} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function LabelEditorBody({
  titleId,
  track,
  onClose,
  onSaved,
}: Omit<Props, 'open'> & { titleId: string }) {
  const { labels, create } = useLabels();
  const initial = track.labels.map((l) => l.id);
  const [ids, setIds] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    const changed = ids.length !== initial.length || ids.some((id, i) => id !== initial[i]);
    if (!changed) return onClose();
    setSaving(true);
    try {
      onSaved(
        await apiFetch<TrackDto>(`/api/tracks/${track.id}`, {
          method: 'PATCH',
          body: { labels: ids },
        }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save labels');
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 id={titleId}>{`Labels for ${track.name}`}</h2>
      <LabelPicker labels={labels} selectedIds={ids} onChange={setIds} onCreate={create} />
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={saving} onClick={() => void done()}>
          Done
        </button>
      </div>
    </div>
  );
}
