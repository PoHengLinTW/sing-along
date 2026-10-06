import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStore } from '../audio/recorder/draftStore';
import type { DraftView } from '../audio/recorder/draftView';
import { DraftPanel } from './DraftPanel';

const base: DraftView = {
  id: 'd1',
  projectId: 1,
  mimeType: 'audio/flac',
  engineId: -3,
  name: 'Alto',
  performer: 'Ann',
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 2000,
  peaks: [0.5],
  labelIds: [],
  blob: new Blob([new Uint8Array(1)]),
};
let onUpload: ReturnType<typeof vi.fn<(d: DraftView, p: (f: number) => void) => Promise<void>>>;
let store: DraftStore;

async function show(over: Partial<DraftView> = {}) {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  onUpload = vi.fn(async () => {});
  return render(<DraftPanel draft={{ ...base, ...over }} store={store} onUpload={onUpload} />);
}
const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const dialog = () => screen.getByRole('dialog');

beforeEach(() => vi.clearAllMocks());

describe('a take that is not linked to a saved track', () => {
  it('uploads straight away, with no question', async () => {
    await show();
    fireEvent.click(button(/upload alto/i));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a saved track checked out for editing', () => {
  const editing = { replacesTrackId: 42 };

  it('is shown as an edit of a saved track, not as a new take', async () => {
    await show(editing);
    expect(screen.getByText('Editing')).toBeTruthy();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(screen.getByText(/editing a saved track/i)).toBeTruthy();
    expect(screen.queryByText(/not uploaded/i)).toBeNull();
  });

  it('has a "Save over the original" button instead of Upload', async () => {
    await show(editing);
    expect(button(/save alto over the original/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^upload alto/i })).toBeNull();
  });

  it('asks before overwriting, and says what will happen', async () => {
    await show(editing);
    fireEvent.click(button(/save alto over the original/i));
    expect(onUpload).not.toHaveBeenCalled();
    const d = within(dialog());
    expect(d.getByRole('heading', { name: /overwrite saved track/i })).toBeTruthy();
    expect(dialog().textContent).toMatch(/'Alto'/);
    expect(dialog().textContent).toMatch(/for everyone/i);
    expect(dialog().textContent).toMatch(/cannot be undone/i);
  });

  it('starts on the safe choice: Cancel has the focus', async () => {
    await show(editing);
    fireEvent.click(button(/save alto over the original/i));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Cancel' })),
    );
  });

  it('Cancel changes nothing, and the take stays to be saved later', async () => {
    await show(editing);
    fireEvent.click(button(/save alto over the original/i));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(onUpload).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button(/save alto over the original/i).disabled).toBe(false);
  });

  it('Escape cancels too: the dialog closes and nothing is sent', async () => {
    await show(editing);
    fireEvent.click(button(/save alto over the original/i));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent(dialog(), new Event('cancel', { cancelable: true })); // what the browser fires on Escape
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onUpload).not.toHaveBeenCalled();
    expect(button(/save alto over the original/i).disabled).toBe(false);
  });

  it('clicking the backdrop is not a way to confirm', async () => {
    await show(editing);
    fireEvent.click(button(/save alto over the original/i));
    fireEvent.click(dialog());
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('Overwrite saves once', async () => {
    await show(editing);
    fireEvent.click(button(/save alto over the original/i));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload.mock.calls[0]?.[0].replacesTrackId).toBe(42);
  });

  it('names how many other saved tracks will be deleted when takes were combined into it', async () => {
    await show({ ...editing, deletesTrackIds: [7, 8] });
    fireEvent.click(button(/save alto over the original/i));
    expect(dialog().textContent).toMatch(/2 other saved tracks/i);
    expect(dialog().textContent).toMatch(/deleted/i);
  });

  it('says "1 other saved track" in the singular', async () => {
    await show({ ...editing, deletesTrackIds: [7] });
    fireEvent.click(button(/save alto over the original/i));
    expect(dialog().textContent).toMatch(/1 other saved track\b(?!s)/i);
  });

  it('a retry after a failed save does not ask again: the answer was already given', async () => {
    await show(editing);
    onUpload.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(button(/save alto over the original/i));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Overwrite' }));
    await screen.findByRole('alert');
    fireEvent.click(button(/retry/i));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('discarding is called stopping the edit, and says the saved track is not changed', async () => {
    await show(editing);
    fireEvent.click(button(/discard alto/i));
    const d = within(dialog());
    expect(d.getByRole('heading', { name: /stop editing/i })).toBeTruthy();
    expect(dialog().textContent).toMatch(/saved track is not changed/i);
    expect(d.getByRole('button', { name: 'Discard edits' })).toBeTruthy();
  });
});

describe('a new take that had saved tracks combined into it', () => {
  it('warns that they will be deleted, before saving', async () => {
    await show({ deletesTrackIds: [7, 8, 9] });
    fireEvent.click(button(/upload alto/i));
    expect(onUpload).not.toHaveBeenCalled();
    expect(dialog().textContent).toMatch(/3 saved tracks/i);
    expect(dialog().textContent).toMatch(/deleted/i);
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /upload and delete|save and delete/i }),
    );
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
  });
});

// keeps the unused import honest when the dialog emulation changes
void act;
