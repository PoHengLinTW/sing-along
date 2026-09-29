import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { mixerStore } from '../audio/mixerStore';
import type { DraftView } from '../audio/recorder/draftView';
import { getDraftStore, resetDraftStoreForTests } from '../audio/recorder/storeInstance';
import { AppProviders } from '../providers';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
vi.mock('../audio/useProjectAudio', () => ({ useProjectAudio: () => {} }));
const audioSeen: DraftView[][] = [];
vi.mock('../audio/useDraftAudio', () => ({
  useDraftAudio: (drafts: DraftView[]) => {
    audioSeen.push(drafts);
  },
}));

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const track = {
  id: 1,
  projectId: 7,
  name: 'Lead',
  performer: 'Sam',
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 1000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: 1,
  peaks: [0.5],
  createdAt: '',
};

async function seedReady(name: string, projectId = 7) {
  const store = await getDraftStore();
  const d = await store.createDraft({
    projectId,
    startOffsetMs: 500,
    sampleRate: 48000,
    name,
    performer: 'Ann',
  });
  return store.updateDraft(d.id, {
    status: 'ready',
    blob: new Blob([new Uint8Array(1)]),
    mimeType: 'audio/flac',
    peaks: [0.5],
    durationMs: 2000,
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDraftStoreForTests(); // the opened store is cached at module level
  mixerStore.getState().reset();
  audioSeen.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/labels'
        ? json([])
        : json({
            id: 7,
            title: 'Song',
            artist: null,
            notes: null,
            createdAt: '',
            updatedAt: '',
            tracks: [track],
          }),
    ),
  );
});

const open = () =>
  render(
    <AppProviders>
      <RouterProvider router={createAppRouter(['/project/7'])} />
    </AppProviders>,
  );

describe('drafts on the project page', () => {
  it('lists a stored take below the uploaded tracks, with its lane, and hands it to the engine', async () => {
    const d = await seedReady('Take 1');
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    expect(within(panel).getByText('Draft')).toBeTruthy();
    expect(await screen.findByTestId(`lane-draft-${d.id}`)).toBeTruthy();
    const panels = screen.getAllByTestId(/^panel-/).map((p) => p.getAttribute('data-testid'));
    expect(panels).toEqual(['panel-Lead', `panel-draft-${d.id}`]);
    await waitFor(() => expect(audioSeen.at(-1)?.map((v) => v.id)).toEqual([d.id]));
  });

  it('only shows the takes of this project', async () => {
    await seedReady('Other project take', 99);
    open();
    await screen.findByTestId('panel-Lead');
    await waitFor(() => expect(audioSeen.length).toBeGreaterThan(0));
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('discarding a take removes its panel and lane', async () => {
    const d = await seedReady('Take 1');
    open();
    await screen.findByTestId(`panel-draft-${d.id}`);
    await userEvent.click(screen.getByRole('button', { name: /discard take 1/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^discard$/i }));
    await waitFor(() => expect(screen.queryByTestId(`panel-draft-${d.id}`)).toBeNull());
    expect(screen.queryByTestId(`lane-draft-${d.id}`)).toBeNull();
  });
});
