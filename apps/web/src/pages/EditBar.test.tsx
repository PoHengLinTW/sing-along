import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditHistory } from '../audio/recorder/edit/history';
import { createSelectionStore } from '../audio/recorder/edit/selection';
import { createRecordingStore } from '../audio/recorder/recordingStore';
import { createTransportStore } from '../audio/transportStore';
import { ToastProvider } from '../ui/toast';
import { EditBar } from './EditBar';

const ok = { ok: true } as const;
let history: EditHistory;
let selection: ReturnType<typeof createSelectionStore>;
let transport: ReturnType<typeof createTransportStore>;
let recording: ReturnType<typeof createRecordingStore>;
const editor = {
  split: vi.fn(async () => ok as never),
  combine: vi.fn(async () => ok as never),
  undo: vi.fn(async () => true),
  redo: vi.fn(async () => true),
  get history() {
    return history;
  },
};
const ids = ['a', 'b', 'c'];

function show(draftIds = ids) {
  return render(
    <ToastProvider>
      <EditBar
        draftIds={draftIds}
        editor={editor as never}
        selection={selection}
        transport={transport}
        recording={recording}
      />
    </ToastProvider>,
  );
}
const btn = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const pick = (...picked: string[]) =>
  act(() => {
    for (const id of picked) selection.getState().toggle(id);
  });

beforeEach(() => {
  history = new EditHistory();
  selection = createSelectionStore();
  transport = createTransportStore();
  recording = createRecordingStore();
  for (const fn of [editor.split, editor.combine, editor.undo, editor.redo]) {
    fn.mockClear();
  }
  editor.split.mockResolvedValue(ok as never);
});

describe('EditBar visibility', () => {
  it('is absent when there are no local takes to edit', () => {
    show([]);
    expect(screen.queryByRole('group', { name: /edit takes/i })).toBeNull();
  });
  it('has no trim buttons: trimming is done with the handles on the take', () => {
    show();
    expect(screen.queryByRole('button', { name: /trim/i })).toBeNull();
    expect(screen.getByText(/drag the handles/i)).toBeTruthy();
  });

  it('is present with takes, and tells how to use it', () => {
    show();
    expect(screen.getByRole('group', { name: /edit takes/i })).toBeTruthy();
    expect(screen.getByText(/select a take/i)).toBeTruthy();
  });
});

describe('EditBar enabling', () => {
  it('needs one selected take to split, two or more to combine', () => {
    show();
    expect(btn(/split/i).disabled).toBe(true);
    expect(btn(/combine/i).disabled).toBe(true);
    pick('a');
    expect(btn(/split/i).disabled).toBe(false);
    expect(btn(/combine/i).disabled).toBe(true);
    pick('b');
    expect(btn(/split/i).disabled).toBe(true);
    expect(btn(/combine/i).disabled).toBe(false);
  });

  it('Undo and Redo follow the history, and name the edit', () => {
    show();
    expect(btn(/^undo/i).disabled).toBe(true);
    expect(btn(/^redo/i).disabled).toBe(true);
    act(() => history.push({ label: 'Split', before: [], after: [] }));
    expect(btn(/^undo split/i).disabled).toBe(false);
    act(() => void history.undo());
    expect(btn(/^redo split/i).disabled).toBe(false);
  });

  it('everything is locked while a take is being recorded', () => {
    show();
    pick('a', 'b');
    act(() => history.push({ label: 'Split', before: [], after: [] }));
    act(() => recording.setState({ status: 'recording' }));
    for (const b of screen.getAllByRole('button'))
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('EditBar actions at the playhead', () => {
  beforeEach(() => act(() => transport.setState({ position: 12.3456 })));

  it('Split cuts the selected take at the playhead, in whole milliseconds', async () => {
    show();
    pick('b');
    fireEvent.click(btn(/split/i));
    await waitFor(() => expect(editor.split).toHaveBeenCalledWith('b', 12346));
  });

  it('Combine merges the selected takes and clears the selection', async () => {
    show();
    pick('c', 'a');
    fireEvent.click(btn(/combine/i));
    await waitFor(() => expect(editor.combine).toHaveBeenCalledWith(['c', 'a']));
    await waitFor(() => expect(selection.getState().ids).toEqual([]));
  });

  it('Undo and Redo call the editor', async () => {
    show();
    act(() => history.push({ label: 'Split', before: [], after: [] }));
    fireEvent.click(btn(/^undo/i));
    await waitFor(() => expect(editor.undo).toHaveBeenCalledTimes(1));
  });
});

describe('EditBar explains refusals', () => {
  beforeEach(() => act(() => transport.setState({ position: 1 })));
  const run = async (name: RegExp, result: unknown, picked = ['a']) => {
    editor.split.mockResolvedValue(result as never);
    editor.combine.mockResolvedValue(result as never);
    show();
    pick(...picked);
    fireEvent.click(btn(name));
    return (await screen.findByRole('alert')).textContent ?? '';
  };

  it('a cut outside the take: move the playhead inside it', async () => {
    expect(await run(/split/i, { ok: false, reason: 'outside' })).toMatch(/playhead.*inside/i);
  });
  it('overlapping takes: says by how much', async () => {
    expect(
      await run(/combine/i, { ok: false, reason: 'overlap', overlapMs: 1250 }, ['a', 'b']),
    ).toMatch(/overlap.*1\.25 s/i);
  });
  it('a failure: says nothing was changed', async () => {
    expect(await run(/split/i, { ok: false, reason: 'failed' })).toMatch(/nothing was changed/i);
  });
  it('another edit running: asks to wait', async () => {
    expect(await run(/split/i, { ok: false, reason: 'busy' })).toMatch(/wait/i);
  });
});

describe('EditBar while working', () => {
  it('disables the buttons until the edit is done, so a double click edits once', async () => {
    let finish: (v: unknown) => void = () => {};
    editor.split.mockReturnValue(new Promise((r) => (finish = r)) as never);
    show();
    pick('a');
    fireEvent.click(btn(/split/i));
    fireEvent.click(btn(/split/i));
    expect(editor.split).toHaveBeenCalledTimes(1);
    expect(btn(/split/i).disabled).toBe(true);
    await act(async () => finish(ok));
    await waitFor(() => expect(btn(/split/i).disabled).toBe(false));
  });
});

describe('EditBar selection housekeeping', () => {
  it('forgets selected takes that no longer exist', () => {
    const { rerender } = show();
    pick('a', 'b');
    rerender(
      <ToastProvider>
        <EditBar
          draftIds={['a']}
          editor={editor as never}
          selection={selection}
          transport={transport}
          recording={recording}
        />
      </ToastProvider>,
    );
    expect(selection.getState().ids).toEqual(['a']);
  });
});
