import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { mixerStore } from '../audio/mixerStore';
import { draftEngineId } from '../audio/recorder/draftView';
import { getDraftStore, resetDraftStoreForTests } from '../audio/recorder/storeInstance';
import { AppProviders } from '../providers';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
vi.mock('../audio/useProjectAudio', () => ({ useProjectAudio: () => {} }));
vi.mock('../audio/useDraftAudio', () => ({ useDraftAudio: () => {} }));
const put = vi.fn(async (_url: string, _blob: Blob, _h: unknown, onProgress: (f: number) => void) =>
  onProgress(1),
);
vi.mock('../api/put', () => ({ putWithProgress: (...a: Parameters<typeof put>) => put(...a) }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const mkTrack = (id: number, name: string, over = {}) => ({
  id,
  projectId: 7,
  name,
  performer: null,
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 4000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: id,
  peaks: [0.5],
  createdAt: '',
  ...over,
});

let f: ReturnType<typeof vi.fn>;
let confirmStatus = 200;
let draftId: string;
let engineId: number;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetDraftStoreForTests();
  mixerStore.getState().reset();
  put.mockClear();
  confirmStatus = 200;
  f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/labels') return json(200, []);
    if (url.endsWith('/upload-url'))
      return json(201, {
        trackId: 50,
        uploadUrl: 'https://s3/put',
        headers: { 'Content-Type': 'audio/flac' },
        expiresAt: '',
      });
    if (url === '/api/tracks/50/confirm') {
      if (confirmStatus !== 200) return json(confirmStatus, { message: 'boom' });
      return json(
        200,
        mkTrack(50, 'Take 1', { source: 'recording', sortOrder: 2, latencyOffsetMs: -85 }),
      );
    }
    void init;
    return json(200, {
      id: 7,
      title: 'Song',
      artist: null,
      notes: null,
      createdAt: '',
      updatedAt: '',
      tracks: [mkTrack(1, 'Lead')],
    });
  });
  vi.stubGlobal('fetch', f);

  const store = await getDraftStore();
  const d = await store.createDraft({
    projectId: 7,
    startOffsetMs: 1500,
    sampleRate: 48000,
    name: 'Take 1',
    performer: 'Ann',
  });
  await store.updateDraft(d.id, {
    status: 'ready',
    latencyOffsetMs: -85,
    // node's Blob: fake-indexeddb's structured clone drops jsdom's Blob class (real browsers keep it)
    blob: new NodeBlob([new Uint8Array(20)], { type: 'audio/flac' }) as unknown as Blob,
    mimeType: 'audio/flac',
    peaks: [0.5],
    durationMs: 2000,
  });
  draftId = d.id;
  engineId = draftEngineId(d.id);
});

const open = () =>
  render(
    <AppProviders>
      <RouterProvider router={createAppRouter(['/project/7'])} />
    </AppProviders>,
  );
const uploadBodies = () =>
  f.mock.calls
    .filter(([url]) => (url as string).endsWith('/upload-url'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe('uploading a draft from the project page', () => {
  it('sends the take, then the new track replaces the draft and keeps its mix', async () => {
    open();
    await screen.findByTestId(`panel-draft-${draftId}`);
    // set after the page loaded: entering a project restores that project's remembered mix
    mixerStore.getState().setVolume(engineId, 0.6);
    mixerStore.getState().toggleMute(engineId);
    fireEvent.click(screen.getByRole('button', { name: /upload take 1/i }));

    await waitFor(() => expect(screen.queryByTestId(`panel-draft-${draftId}`)).toBeNull(), {
      timeout: 3000,
    });
    expect(uploadBodies()[0]).toMatchObject({
      source: 'recording',
      name: 'Take 1',
      performer: 'Ann',
      startOffsetMs: 1500,
      latencyOffsetMs: -85,
      durationMs: 2000,
      sizeBytes: 20,
      peaks: [0.5],
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('panel-Take 1')).toBeTruthy(); // the uploaded track
    expect(screen.getByTestId('lane-50')).toBeTruthy();
    expect(mixerStore.getState().get(50)).toMatchObject({ volume: 0.6, muted: true });
    expect(mixerStore.getState().byId[engineId]).toBeUndefined();
    expect(await (await getDraftStore()).getDraft(draftId)).toBeUndefined();
  });

  it('keeps the draft and offers Retry when the server fails; retrying then succeeds', async () => {
    confirmStatus = 500;
    open();
    await screen.findByTestId(`panel-draft-${draftId}`);
    fireEvent.click(screen.getByRole('button', { name: /upload take 1/i }));
    await screen.findByRole('button', { name: /retry/i }, { timeout: 3000 });
    expect(await (await getDraftStore()).getDraft(draftId)).toBeDefined();
    expect(screen.getByTestId(`panel-draft-${draftId}`)).toBeTruthy();

    confirmStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.queryByTestId(`panel-draft-${draftId}`)).toBeNull(), {
      timeout: 3000,
    });
  });

  it('a reload mid-upload loses nothing: the draft is still there to upload again', async () => {
    let releasePut: () => void = () => {};
    put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releasePut = resolve;
        }),
    );
    const first = open();
    await screen.findByTestId(`panel-draft-${draftId}`);
    fireEvent.click(screen.getByRole('button', { name: /upload take 1/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    first.unmount(); // "reload": the PUT never finished
    expect(await (await getDraftStore()).getDraft(draftId)).toBeDefined();
    open();
    expect(await screen.findByTestId(`panel-draft-${draftId}`)).toBeTruthy();
    void releasePut;
  });
});
