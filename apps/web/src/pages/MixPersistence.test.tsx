import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { mixerStore } from '../audio/mixerStore';
import { AppProviders } from '../providers';
import { viewStore } from '../timeline/viewStore';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
vi.mock('../audio/useProjectAudio', () => ({ useProjectAudio: () => {} }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const mkTrack = (id: number, name: string) => ({
  id,
  projectId: 7,
  name,
  performer: null,
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 1000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: id,
  peaks: [0.5],
  createdAt: '',
});
let tracks: ReturnType<typeof mkTrack>[];
let f: ReturnType<typeof vi.fn>;

const KEY = 'sing-along:mix:7';
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');

function mount() {
  f = vi.fn(async (url: string) =>
    url === '/api/labels'
      ? json(200, [])
      : json(200, {
          id: 7,
          title: 'Song',
          artist: null,
          notes: null,
          createdAt: '',
          updatedAt: '',
          tracks,
        }),
  );
  vi.stubGlobal('fetch', f);
  return render(
    <AppProviders>
      <RouterProvider router={createAppRouter(['/project/7'])} />
    </AppProviders>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mixerStore.getState().reset();
  viewStore.setState({ pxPerSec: 50, follow: true });
  tracks = [mkTrack(1, 'Lead'), mkTrack(2, 'Alto')];
});
afterEach(() => vi.unstubAllGlobals());

describe('restoring the mix', () => {
  it('reload restores volume, mute, solo and zoom for the project', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        byId: {
          1: { volume: 0.4, muted: true, solo: false },
          2: { volume: 1.2, muted: false, solo: true },
        },
        pxPerSec: 120,
      }),
    );
    mount();
    const lead = await screen.findByTestId('panel-Lead');
    expect((within(lead).getByLabelText('Volume') as HTMLInputElement).value).toBe('40');
    expect(within(lead).getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const alto = screen.getByTestId('panel-Alto');
    expect(within(alto).getByRole('button', { name: 'Solo' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(viewStore.getState().pxPerSec).toBe(120);
  });

  it('new tracks default to 100%, not muted, not soloed', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ byId: { 1: { volume: 0.4, muted: true, solo: false } }, pxPerSec: 50 }),
    );
    mount();
    const alto = await screen.findByTestId('panel-Alto');
    expect((within(alto).getByLabelText('Volume') as HTMLInputElement).value).toBe('100');
    expect(within(alto).getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('ignores and removes the state of deleted tracks', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        byId: {
          1: { volume: 0.4, muted: false, solo: false },
          99: { volume: 0.1, muted: true, solo: true },
        },
        pxPerSec: 50,
      }),
    );
    mount();
    await screen.findByTestId('panel-Lead');
    await waitFor(() => expect(Object.keys(stored().byId)).toEqual(['1']));
    expect(mixerStore.getState().byId[99]).toBeUndefined();
    // the ghost track's solo must not silence the real tracks
    expect(mixerStore.getState().get(1).solo).toBe(false);
  });

  it('starts from defaults with no saved mix, and survives corrupt saved data', async () => {
    localStorage.setItem(KEY, '{{{not json');
    mount();
    const lead = await screen.findByTestId('panel-Lead');
    expect((within(lead).getByLabelText('Volume') as HTMLInputElement).value).toBe('100');
  });
});

describe('saving the mix', () => {
  it('writes changes to localStorage under the project key', async () => {
    mount();
    const lead = await screen.findByTestId('panel-Lead');
    await userEvent.click(within(lead).getByRole('button', { name: 'Solo' }));
    await waitFor(() => expect(stored().byId[1]).toMatchObject({ solo: true, volume: 1 }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Zoom in' })[0] as HTMLElement);
    await waitFor(() => expect(stored().pxPerSec).toBeGreaterThan(50));
  });

  it('is never sent to the server', async () => {
    mount();
    const lead = await screen.findByTestId('panel-Lead');
    await userEvent.click(within(lead).getByRole('button', { name: 'Mute' }));
    await userEvent.click(within(lead).getByRole('button', { name: 'Solo' }));
    await waitFor(() => expect(stored().byId[1].muted).toBe(true));
    const writes = f.mock.calls.filter(
      ([, init]) =>
        (init as RequestInit | undefined)?.method && (init as RequestInit).method !== 'GET',
    );
    expect(writes).toEqual([]);
    for (const [, init] of f.mock.calls) {
      expect(String((init as RequestInit | undefined)?.body ?? '')).not.toMatch(
        /volume|muted|solo/,
      );
    }
  });

  it('projects keep separate mixes', async () => {
    localStorage.setItem(
      'sing-along:mix:8',
      JSON.stringify({ byId: { 1: { volume: 0.1, muted: true, solo: true } }, pxPerSec: 300 }),
    );
    mount();
    await screen.findByTestId('panel-Lead');
    expect(mixerStore.getState().get(1).volume).toBe(1);
    expect(viewStore.getState().pxPerSec).toBe(50);
  });
});

describe('Reset mix', () => {
  it('restores volume, mute and solo defaults and saves them', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ byId: { 1: { volume: 0.4, muted: true, solo: true } }, pxPerSec: 50 }),
    );
    mount();
    const lead = await screen.findByTestId('panel-Lead');
    await userEvent.click(screen.getByRole('button', { name: 'Reset mix' }));
    expect((within(lead).getByLabelText('Volume') as HTMLInputElement).value).toBe('100');
    expect(within(lead).getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(within(lead).getByRole('button', { name: 'Solo' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    await waitFor(() => expect(stored().byId).toEqual({}));
  });
});
