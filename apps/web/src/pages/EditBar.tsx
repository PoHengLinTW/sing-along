import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { type DraftEditor, type EditResult, getDraftEditor } from '../audio/recorder/edit/editor';
import { type SelectionState, selectionStore } from '../audio/recorder/edit/selection';
import { type RecordingState, recordingStore } from '../audio/recorder/recordingStore';
import { type TransportState, transportStore } from '../audio/transportStore';
import { useToast } from '../ui/toast';

interface Props {
  /** Ids of the local takes on this page. */
  draftIds: string[];
  editor?: Pick<DraftEditor, 'split' | 'combine' | 'undo' | 'redo' | 'history'>;
  selection?: StoreApi<SelectionState>;
  transport?: StoreApi<TransportState>;
  recording?: StoreApi<RecordingState>;
}

export const REFUSALS: Record<string, (r: EditResult & { ok: false }) => string> = {
  outside: () => 'Move the playhead inside the selected take first.',
  overlap: (r) =>
    `These takes overlap by ${((r.overlapMs ?? 0) / 1000).toFixed(2).replace(/0$/, '')} s. Trim or move one first.`,
  busy: () => 'Wait for the current edit to finish.',
  'too-few': () => 'Select two or more takes to combine.',
  'sample-rate': () =>
    "These takes were recorded at different sample rates, so they can't be combined.",
  'not-ready': () => 'That take is still being prepared.',
  failed: () => "Couldn't edit the take. Nothing was changed.",
};

/**
 * Edits for local takes: split, trim and combine at the playhead, with undo and redo. Takes are
 * chosen with the checkbox on their panel. Locked while a take is being recorded.
 */
export function EditBar({
  draftIds,
  editor,
  selection = selectionStore,
  transport = transportStore,
  recording = recordingStore,
}: Props) {
  const toast = useToast();
  const ed = editor ?? getDraftEditor();
  const selected = useStore(selection, (s) => s.ids);
  const locked = useStore(recording, (s) => s.status !== 'idle');
  const [busy, setBusy] = useState(false);
  const h = ed.history;
  useSyncExternalStore(
    (fn) => h.subscribe(fn),
    () => `${h.canUndo}|${h.undoLabel}|${h.canRedo}|${h.redoLabel}`,
  );

  const key = draftIds.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the id list
  useEffect(() => selection.getState().prune(draftIds), [key, selection]);

  if (draftIds.length === 0) return null;

  const playheadMs = () => Math.round(transport.getState().position * 1000);
  const off = locked || busy;
  const one = selected.length === 1 ? (selected[0] as string) : null;

  const run = async (job: () => Promise<EditResult | boolean>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await job();
      if (typeof result === 'object' && !result.ok) {
        toast.error((REFUSALS[result.reason] ?? REFUSALS.failed)?.(result) ?? '');
      } else after?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="edit-bar" aria-label="Edit takes">
      <span className="edit-hint">
        {selected.length === 0
          ? 'Select a take with its checkbox to split it at the playhead; select two or more to combine. To trim a take, drag the handles at its ends.'
          : `${selected.length} selected`}
      </span>
      <div className="edit-actions">
        <button
          type="button"
          disabled={off || !h.canUndo}
          title="Undo the last edit"
          onClick={() => void run(() => ed.undo())}
        >
          {h.canUndo ? `Undo ${h.undoLabel}` : 'Undo'}
        </button>
        <button
          type="button"
          disabled={off || !h.canRedo}
          title="Redo the edit you undid"
          onClick={() => void run(() => ed.redo())}
        >
          {h.canRedo ? `Redo ${h.redoLabel}` : 'Redo'}
        </button>
        <button
          type="button"
          disabled={off || !one}
          title="Cut the selected take in two at the playhead"
          onClick={() => one && void run(() => ed.split(one, playheadMs()))}
        >
          Split at playhead
        </button>
        <button
          type="button"
          disabled={off || selected.length < 2}
          title="Join the selected takes into one; gaps stay as silence"
          onClick={() =>
            void run(
              () => ed.combine(selected),
              () => selection.getState().clear(),
            )
          }
        >
          Combine selected
        </button>
      </div>
    </fieldset>
  );
}
