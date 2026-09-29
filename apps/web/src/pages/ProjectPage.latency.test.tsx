import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { mixerStore } from '../audio/mixerStore';
import { getDraftStore, resetDraftStoreForTests } from '../audio/recorder/storeInstance';
import { AppProviders } from '../providers';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
vi.mock('../audio/useProjectAudio', () => ({ useProjectAudio: () => {} }));
vi.mock('../audio/useDraftAudio', () => ({ useDraftAudio: () => {} }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const track = {
  id: 1,
  projectId: 7,
  name: 'Lead',
  performer: 'Sam',
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 4000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: 1,
  peaks: [0.5],
  createdAt: '',
};

let f: ReturnType<typeof vi.fn>;
let patchStatus = 200;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDraftStoreForTests();
  mixerStore.getState().reset();
  patchStatus = 200;
  f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/labels') return json(200, []);
    if (init?.method === 'PATCH') {
      if (patchStatus !== 200) return json(patchStatus, { message: 'nope' });
      return json(200, { ...track, ...JSON.parse(init.body as string) });
    }
    return json(200, {
      id: 7,
      title: 'Song',
      artist: null,
      notes: null,
      createdAt: '',
      updatedAt: '',
      tracks: [track],
    });
  });
  vi.stubGlobal('fetch', f);
});

const open = () =>
  render(
    <AppProviders>
      <RouterProvider router={createAppRouter(['/project/7'])} />
    </AppProviders>,
  );
const patches = () =>
  f.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([url, init]) => ({ url, body: JSON.parse((init as RequestInit).body as string) }));
const laneLeft = (testId: string) =>
  Number.parseFloat((screen.getByTestId(testId) as HTMLElement).style.left);

describe('latency on an uploaded track', () => {
  it('moves the lane at once, then saves one PATCH after the edits stop', async () => {
    open();
    const panel = await screen.findByTestId('panel-Lead');
    const field = within(panel).getByRole('spinbutton', { name: /latency offset/i });
    expect(laneLeft('lane-1')).toBe(0);
    fireEvent.change(field, { target: { value: '100' } });
    fireEvent.change(field, { target: { value: '150' } });
    expect(laneLeft('lane-1')).toBeGreaterThan(0); // live, before anything is saved
    expect(patches()).toEqual([]);
    await waitFor(() => expect(patches()).toHaveLength(1), { timeout: 2000 });
    expect(patches()[0]).toEqual({ url: '/api/tracks/1', body: { latencyOffsetMs: 150 } });
  });

  it('reverts and tells the user when saving fails', async () => {
    patchStatus = 500;
    open();
    const panel = await screen.findByTestId('panel-Lead');
    fireEvent.change(within(panel).getByRole('spinbutton', { name: /latency offset/i }), {
      target: { value: '200' },
    });
    expect((await screen.findByRole('alert', {}, { timeout: 2000 })).textContent).toMatch(
      /latency/i,
    );
    await waitFor(() => expect(laneLeft('lane-1')).toBe(0));
  });

  it('reset saves 0', async () => {
    open();
    const panel = await screen.findByTestId('panel-Lead');
    fireEvent.change(within(panel).getByRole('spinbutton', { name: /latency offset/i }), {
      target: { value: '80' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: /reset/i }));
    await waitFor(() => expect(patches().at(-1)?.body).toEqual({ latencyOffsetMs: 0 }), {
      timeout: 2000,
    });
    expect(laneLeft('lane-1')).toBe(0);
  });
});

describe('latency on a draft', () => {
  it('moves the lane at once and stores the value on the draft (it goes up with the upload)', async () => {
    const store = await getDraftStore();
    const d = await store.createDraft({
      projectId: 7,
      startOffsetMs: 0,
      sampleRate: 48000,
      name: 'Take 1',
      performer: '',
    });
    await store.updateDraft(d.id, {
      status: 'ready',
      blob: new Blob([new Uint8Array(1)]),
      mimeType: 'audio/flac',
      peaks: [0.5],
      durationMs: 2000,
    });
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    fireEvent.change(within(panel).getByRole('spinbutton', { name: /latency offset/i }), {
      target: { value: '-120' },
    });
    await waitFor(() => expect(laneLeft(`lane-draft-${d.id}`)).toBeLessThan(0));
    expect(patches()).toEqual([]); // drafts never touch the server
    await waitFor(async () => expect((await store.getDraft(d.id))?.latencyOffsetMs).toBe(-120), {
      timeout: 2000,
    });
  });
});
