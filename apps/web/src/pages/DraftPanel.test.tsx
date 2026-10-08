import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { mixerStore } from '../audio/mixerStore';
import { DraftStore } from '../audio/recorder/draftStore';
import { type DraftView, toDraftView } from '../audio/recorder/draftView';
import { editHistory } from '../audio/recorder/edit/history';
import { selectionStore } from '../audio/recorder/edit/selection';
import { PERFORMER_KEY } from '../audio/recorder/performer';
import { DraftPanel } from './DraftPanel';

let store: DraftStore;
let view: DraftView;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await DraftStore.open();
  mixerStore.getState().reset();
  const d = await store.createDraft({
    projectId: 1,
    startOffsetMs: 0,
    sampleRate: 48000,
    name: 'Take 1',
    performer: 'Ann',
  });
  const ready = await store.updateDraft(d.id, {
    status: 'ready',
    blob: new Blob([new Uint8Array(1)]),
    mimeType: 'audio/flac',
    peaks: [0.5],
    durationMs: 1000,
  });
  view = toDraftView(ready) as DraftView;
  render(<DraftPanel draft={view} store={store} />);
});

describe('DraftPanel editing', () => {
  beforeEach(() => {
    selectionStore.getState().clear();
    editHistory.clear();
  });

  it('has a checkbox that selects the take for editing', () => {
    const box = screen.getByRole('checkbox', {
      name: 'Select Take 1 for editing',
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(selectionStore.getState().ids).toEqual([view.id]);
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(selectionStore.getState().ids).toEqual([]);
  });

  it('discarding the take also drops its edits from the undo history', async () => {
    editHistory.push({ label: 'Split', before: [], after: [{ id: view.id } as never] });
    fireEvent.click(screen.getByRole('button', { name: /discard take 1/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(editHistory.canUndo).toBe(false));
  });
});

describe('DraftPanel', () => {
  it('is clearly a draft: badge and "Not uploaded"', () => {
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText(/not uploaded/i)).toBeTruthy();
  });

  it('shows the name and the pre-filled performer, and both can be edited and are stored', async () => {
    const name = screen.getByLabelText('Take name') as HTMLInputElement;
    const performer = screen.getByLabelText('Performer') as HTMLInputElement;
    expect(name.value).toBe('Take 1');
    expect(performer.value).toBe('Ann');
    await userEvent.clear(name);
    await userEvent.type(name, 'Alto line{Enter}');
    await waitFor(async () => expect((await store.getDraft(view.id))?.name).toBe('Alto line'));
    await userEvent.clear(performer);
    await userEvent.type(performer, 'Bo{Enter}');
    await waitFor(async () => expect((await store.getDraft(view.id))?.performer).toBe('Bo'));
    expect(localStorage.getItem(PERFORMER_KEY)).toBe('Bo'); // pre-fills the next take
  });

  it('refuses an empty name', async () => {
    const name = screen.getByLabelText('Take name');
    await userEvent.clear(name);
    await userEvent.type(name, '{Enter}');
    expect(await screen.findByText(/name is required/i)).toBeTruthy();
    expect((await store.getDraft(view.id))?.name).toBe('Take 1');
  });

  it('lets the volume go up to 300%', () => {
    const slider = screen.getByLabelText('Volume') as HTMLInputElement;
    expect(slider.max).toBe('300');
    fireEvent.change(slider, { target: { value: '300' } });
    expect(mixerStore.getState().get(view.engineId).volume).toBeCloseTo(3);
  });

  it("has volume, mute and solo like any track, under the draft's engine id", () => {
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '80' } });
    expect(mixerStore.getState().get(view.engineId).volume).toBeCloseTo(0.8);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(mixerStore.getState().get(view.engineId).muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Solo' }));
    expect(mixerStore.getState().get(view.engineId).solo).toBe(true);
  });

  it('asks before discarding and warns that the take exists only on this device', async () => {
    await userEvent.click(screen.getByRole('button', { name: /discard take 1/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/exists only on this device/i)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(await store.getDraft(view.id)).toBeDefined();
  });

  it('removes the draft from IndexedDB and forgets its mix after confirming', async () => {
    mixerStore.getState().setVolume(view.engineId, 0.5);
    await userEvent.click(screen.getByRole('button', { name: /discard take 1/i }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /discard/i }));
    });
    await waitFor(async () => expect(await store.getDraft(view.id)).toBeUndefined());
    expect(mixerStore.getState().byId[view.engineId]).toBeUndefined();
  });
});
