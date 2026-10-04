import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { mixerStore } from '../audio/mixerStore';
import { recordingStore, resetRecording } from '../audio/recorder/recordingStore';
import { getDraftStore, resetDraftStoreForTests } from '../audio/recorder/storeInstance';
import { AppProviders } from '../providers';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
const engineTracks: number[][] = [];
vi.mock('../audio/useProjectAudio', () => ({
  useProjectAudio: (tracks: { id: number }[]) => {
    engineTracks.push(tracks.map((t) => t.id));
    return () => {};
  },
}));
vi.mock('../audio/useDraftAudio', () => ({ useDraftAudio: () => {} }));
const put = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../api/put', () => ({ putWithProgress: put }));
vi.mock('../audio/controller', async (orig) => ({
  ...(await orig<typeof import('../audio/controller')>()),
  getAudioController: () => ({
    engine: { ensureContext: () => ({ sampleRate: 48000 }) },
    previewAround: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setOffsets: vi.fn(),
    beginRecording: vi.fn(),
    endRecording: vi.fn(),
  }),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const mkTrack = (id: number, name: string, over = {}) => ({
  id,
  projectId: 7,
  name,
  performer: 'Sam',
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 8000,
  mimeType: 'audio/flac',
  sizeBytes: 4000,
  source: 'upload',
  sortOrder: id,
  peaks: [0.5],
  createdAt: '',
  ...over,
});
let tracks: ReturnType<typeof mkTrack>[];
let calls: { method: string; url: string; body?: unknown }[];
let handler: (method: string, url: string, body: unknown) => Response | undefined;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDraftStoreForTests();
  mixerStore.getState().reset();
  engineTracks.length = 0;
  calls = [];
  put.mockClear();
  resetRecording();
  put.mockResolvedValue(undefined);
  tracks = [mkTrack(1, 'Lead'), mkTrack(2, 'Harmony')];
  handler = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, url, body });
      const custom = handler(method, url, body);
      if (custom) return custom;
      if (url === '/api/labels') return json(200, []);
      if (url === '/api/tracks/1/audio-url')
        return json(200, { url: 'https://s3/get/1', expiresAt: '' });
      if (url.startsWith('https://s3/get')) return new Response(new Uint8Array(40));
      if (url === '/api/tracks/1/replace-url') {
        return json(200, {
          key: 'projects/7/tracks/1-new.flac',
          uploadUrl: 'https://s3/put',
          headers: { 'Content-Type': 'audio/flac' },
          expiresAt: '',
        });
      }
      if (url === '/api/tracks/1/replace') {
        return json(200, {
          ...tracks[0],
          name: body.name,
          durationMs: body.durationMs,
          sizeBytes: body.sizeBytes,
          peaks: body.peaks,
        });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return json(200, {
        id: 7,
        title: 'Song',
        artist: null,
        notes: null,
        createdAt: '',
        updatedAt: '',
        tracks,
      });
    }),
  );
});

const open = () =>
  render(
    <AppProviders>
      <RouterProvider router={createAppRouter(['/project/7'])} />
    </AppProviders>,
  );

async function seedEditing(over: Record<string, unknown> = {}) {
  const store = await getDraftStore();
  const d = await store.createDraft({
    projectId: 7,
    startOffsetMs: 0,
    sampleRate: 48000,
    name: 'Lead',
    performer: 'Sam',
  });
  return store.updateDraft(d.id, {
    status: 'ready',
    blob: new NodeBlob([new Uint8Array(1)]) as unknown as Blob, // fake-indexeddb drops jsdom's Blob
    mimeType: 'audio/flac',
    peaks: [0.9, 0.1],
    durationMs: 3000,
    replacesTrackId: 1,
    ...over,
  });
}
const made = (method: string, url: string) =>
  calls.filter((c) => c.method === method && c.url === url);

describe('editing a saved track', () => {
  it('every saved track has an Edit button', async () => {
    open();
    const lead = await screen.findByTestId('panel-Lead');
    expect(within(lead).getByRole('button', { name: /edit audio of lead/i })).toBeTruthy();
    expect(
      within(screen.getByTestId('panel-Harmony')).getByRole('button', {
        name: /edit audio of harmony/i,
      }),
    ).toBeTruthy();
  });

  it('Edit checks the track out: its panel and lane give way to an "Editing" take', async () => {
    open();
    const lead = await screen.findByTestId('panel-Lead');
    await userEvent.click(within(lead).getByRole('button', { name: /edit audio of lead/i }));
    const store = await getDraftStore();
    await waitFor(async () => expect(await store.listDrafts(7)).toHaveLength(1));
    const [draft] = await store.listDrafts(7);
    expect(draft).toMatchObject({ replacesTrackId: 1, name: 'Lead', status: 'ready' });
    await waitFor(() => expect(screen.queryByTestId('panel-Lead')).toBeNull());
    expect(screen.queryByTestId('lane-1')).toBeNull();
    const panel = await screen.findByTestId(`panel-draft-${draft?.id}`);
    expect(within(panel).getByText('Editing')).toBeTruthy();
    expect(screen.getByTestId('panel-Harmony')).toBeTruthy();
  });

  it('the engine stops playing the original while it is being edited, and the other tracks stay', async () => {
    open();
    await userEvent.click(
      within(await screen.findByTestId('panel-Lead')).getByRole('button', {
        name: /edit audio of lead/i,
      }),
    );
    await waitFor(() => expect(engineTracks.at(-1)).toEqual([2]));
  });

  it('a track being edited is still hidden after a reload', async () => {
    await seedEditing();
    open();
    await screen.findByTestId('panel-Harmony');
    expect(screen.queryByTestId('panel-Lead')).toBeNull();
    expect(engineTracks.at(-1)).toEqual([2]);
  });

  it('says so, and creates nothing, when the audio cannot be fetched', async () => {
    handler = (_m, url) =>
      url === '/api/tracks/1/audio-url' ? json(500, { message: 'down' }) : undefined;
    open();
    await userEvent.click(
      within(await screen.findByTestId('panel-Lead')).getByRole('button', {
        name: /edit audio of lead/i,
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't open.*for editing/i);
    expect((await (await getDraftStore()).listDrafts(7)).length).toBe(0);
    expect(screen.getByTestId('panel-Lead')).toBeTruthy();
  });
});

describe('saving an edited track over the original', () => {
  it('asks first; Cancel sends nothing', async () => {
    const d = await seedEditing();
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    await userEvent.click(
      within(panel).getByRole('button', { name: /save lead over the original/i }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(made('POST', '/api/tracks/1/replace-url')).toHaveLength(0);
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByTestId(`panel-draft-${d.id}`)).toBeTruthy();
  });

  it('Overwrite uploads the new audio and swaps the track over; the take is gone and the track is back', async () => {
    const d = await seedEditing({ name: 'Lead (trimmed)' });
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    await userEvent.click(
      within(panel).getByRole('button', { name: /save lead \(trimmed\) over the original/i }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Overwrite' }),
    );
    await waitFor(() => expect(made('POST', '/api/tracks/1/replace')).toHaveLength(1));
    expect(put).toHaveBeenCalledTimes(1);
    expect(made('POST', '/api/tracks/1/replace-url')[0]?.body).toMatchObject({
      durationMs: 3000,
      sizeBytes: 1,
    });
    expect(made('POST', '/api/tracks/1/replace')[0]?.body).toMatchObject({
      key: 'projects/7/tracks/1-new.flac',
      name: 'Lead (trimmed)',
      durationMs: 3000,
    });
    await waitFor(() => expect(screen.queryByTestId(`panel-draft-${d.id}`)).toBeNull());
    const back = await screen.findByTestId('panel-Lead (trimmed)');
    expect(back).toBeTruthy();
    expect(engineTracks.at(-1)).toEqual([1, 2]);
    expect((await (await getDraftStore()).listDrafts(7)).length).toBe(0);
  });

  it('the take keeps the volume the user set while editing', async () => {
    const d = await seedEditing();
    mixerStore.getState().setVolume(-1, 0.3); // placeholder id, replaced below
    mixerStore.getState().reset();
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    fireEvent.change(within(panel).getByLabelText('Volume'), { target: { value: '40' } });
    await userEvent.click(within(panel).getByRole('button', { name: /over the original/i }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Overwrite' }),
    );
    await waitFor(() => expect(mixerStore.getState().get(1).volume).toBeCloseTo(0.4));
  });

  it('deletes the tracks that were combined into it, and they leave the page', async () => {
    const d = await seedEditing({ deletesTrackIds: [2] });
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    await userEvent.click(within(panel).getByRole('button', { name: /over the original/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/1 other saved track/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(made('DELETE', '/api/tracks/2')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('panel-Harmony')).toBeNull());
    expect(calls.findIndex((c) => c.url === '/api/tracks/1/replace')).toBeLessThan(
      calls.findIndex((c) => c.method === 'DELETE'),
    );
  });

  it('a failed save keeps the take, keeps the original hidden, and offers a retry', async () => {
    handler = (_m, url) =>
      url === '/api/tracks/1/replace' ? json(500, { message: 'boom' }) : undefined;
    const d = await seedEditing();
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    await userEvent.click(within(panel).getByRole('button', { name: /over the original/i }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Overwrite' }),
    );
    expect((await within(panel).findByRole('alert')).textContent).toMatch(/failed/i);
    expect(screen.queryByTestId('panel-Lead')).toBeNull();
    expect(within(panel).getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('Stop editing discards the copy and brings the untouched original back', async () => {
    const d = await seedEditing();
    open();
    const panel = await screen.findByTestId(`panel-draft-${d.id}`);
    await userEvent.click(within(panel).getByRole('button', { name: /discard lead/i }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edits' }),
    );
    await waitFor(() => expect(screen.getByTestId('panel-Lead')).toBeTruthy());
    expect(engineTracks.at(-1)).toEqual([1, 2]);
    expect(calls.filter((c) => c.method !== 'GET' && c.url.startsWith('/api/tracks'))).toEqual([]);
  });
});

describe('while a saved track is out for editing', () => {
  it('reordering is paused, with the reason on the buttons, so the order sent is never partial', async () => {
    await seedEditing();
    open();
    const harmony = await screen.findByTestId('panel-Harmony');
    const up = within(harmony).getByRole('button', {
      name: /move harmony up/i,
    }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    expect(up.title).toMatch(/finish editing/i);
  });

  it('Edit is unavailable while a take is being recorded', async () => {
    recordingStore.setState({ status: 'recording' });
    open();
    const lead = await screen.findByTestId('panel-Lead');
    expect(
      (within(lead).getByRole('button', { name: /edit audio of lead/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('clicking Edit twice quickly makes one copy', async () => {
    open();
    const button = within(await screen.findByTestId('panel-Lead')).getByRole('button', {
      name: /edit audio of lead/i,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByTestId('panel-Lead')).toBeNull());
    expect((await (await getDraftStore()).listDrafts(7)).length).toBe(1);
    expect(made('GET', '/api/tracks/1/audio-url')).toHaveLength(1);
  });
});
