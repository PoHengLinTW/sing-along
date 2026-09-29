import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { mixerStore } from '../audio/mixerStore';
import { AppProviders } from '../providers';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
vi.mock('../audio/useProjectAudio', () => ({ useProjectAudio: () => {} }));

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
  durationMs: 1000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: id,
  peaks: [0.5],
  createdAt: '',
  ...over,
});
let project: {
  id: number;
  title: string;
  artist: null;
  notes: null;
  createdAt: string;
  updatedAt: string;
  tracks: ReturnType<typeof mkTrack>[];
};
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
let extra: Handler;
let f: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mixerStore.getState().reset();
  extra = () => undefined;
  project = {
    id: 7,
    title: 'Song',
    artist: null,
    notes: null,
    createdAt: '',
    updatedAt: '',
    tracks: [mkTrack(1, 'Lead'), mkTrack(2, 'Alto'), mkTrack(3, 'Bass')],
  };
  f = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = extra(url, init);
    if (custom) return custom;
    if (url === '/api/labels') return json(200, []);
    return json(200, structuredClone(project));
  });
  vi.stubGlobal('fetch', f);
  render(
    <AppProviders>
      <RouterProvider router={createAppRouter(['/project/7'])} />
    </AppProviders>,
  );
});
afterEach(() => vi.unstubAllGlobals());

const panel = async (name: string) => (await screen.findByTestId(`panel-${name}`)) as HTMLElement;
const calls = (method: string) =>
  f.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
    .map(([url, init]) => ({
      url: url as string,
      body: (init as RequestInit).body
        ? JSON.parse((init as RequestInit).body as string)
        : undefined,
    }));
const order = () =>
  screen.getAllByTestId(/^panel-/).map((p) => p.getAttribute('data-testid')?.replace('panel-', ''));

describe('track panel', () => {
  it('shows name, performer and a 100% volume slider per track', async () => {
    const lead = await panel('Lead');
    expect((within(lead).getByLabelText('Track name') as HTMLInputElement).value).toBe('Lead');
    expect((within(lead).getByLabelText('Performer') as HTMLInputElement).value).toBe('Sam');
    const vol = within(lead).getByLabelText('Volume') as HTMLInputElement;
    expect(vol.value).toBe('100');
    expect(vol.max).toBe('150');
    expect(within(lead).getByText('100%')).toBeTruthy();
  });

  it('volume slider changes the mix live (0-150%)', async () => {
    const lead = await panel('Lead');
    fireEvent.change(within(lead).getByLabelText('Volume'), { target: { value: '120' } });
    expect(mixerStore.getState().get(1).volume).toBeCloseTo(1.2);
    expect(within(lead).getByText('120%')).toBeTruthy();
  });

  it('mute and solo toggle and show their state', async () => {
    const alto = await panel('Alto');
    const mute = within(alto).getByRole('button', { name: 'Mute' });
    const solo = within(alto).getByRole('button', { name: 'Solo' });
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(mute);
    await userEvent.click(solo);
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(solo.getAttribute('aria-pressed')).toBe('true');
    expect(mixerStore.getState().get(2)).toMatchObject({ muted: true, solo: true });
  });

  it('name and performer save on blur through PATCH', async () => {
    const lead = await panel('Lead');
    const name = within(lead).getByLabelText('Track name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Lead vocal');
    await userEvent.tab();
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1));
    expect(calls('PATCH')[0]).toEqual({ url: '/api/tracks/1', body: { name: 'Lead vocal' } });
  });
});

describe('deleting a track', () => {
  it('asks for confirmation, then removes the track from the view and the mixer', async () => {
    extra = (_url, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined;
    mixerStore.getState().setVolume(2, 0.3);
    const alto = await panel('Alto');
    await userEvent.click(within(alto).getByRole('button', { name: 'Delete Alto' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText("Delete 'Alto'? This cannot be undone.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(order()).toEqual(['Lead', 'Bass']));
    expect(calls('DELETE')[0]?.url).toBe('/api/tracks/2');
    expect(mixerStore.getState().byId[2]).toBeUndefined();
  });

  it('cancel keeps the track', async () => {
    const alto = await panel('Alto');
    await userEvent.click(within(alto).getByRole('button', { name: 'Delete Alto' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(calls('DELETE')).toHaveLength(0);
    expect(order()).toEqual(['Lead', 'Alto', 'Bass']);
  });
});

describe('reordering', () => {
  const drag = (from: HTMLElement, to: HTMLElement) => {
    const dataTransfer = { setData: vi.fn(), getData: () => '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });
    fireEvent.dragEnd(from, { dataTransfer });
  };

  it('dragging a row reorders and saves the full order', async () => {
    extra = (_url, init) =>
      init?.method === 'PUT'
        ? json(200, {
            ...project,
            tracks: [project.tracks[2], project.tracks[0], project.tracks[1]],
          })
        : undefined;
    const lead = await panel('Lead');
    const bass = await panel('Bass');
    act(() => drag(bass, lead));
    await waitFor(() => expect(order()).toEqual(['Bass', 'Lead', 'Alto'])); // optimistic
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(calls('PUT')[0]).toEqual({
      url: '/api/projects/7/track-order',
      body: { trackIds: [3, 1, 2] },
    });
  });

  it('the move buttons are a keyboard alternative', async () => {
    extra = (_url, init) =>
      init?.method === 'PUT'
        ? json(200, {
            ...project,
            tracks: [project.tracks[1], project.tracks[0], project.tracks[2]],
          })
        : undefined;
    const alto = await panel('Alto');
    await userEvent.click(within(alto).getByRole('button', { name: 'Move Alto up' }));
    await waitFor(() => expect(order()).toEqual(['Alto', 'Lead', 'Bass']));
    await waitFor(() => expect(calls('PUT')[0]?.body).toEqual({ trackIds: [2, 1, 3] }));
  });

  it('rolls the list back and shows a toast when saving fails', async () => {
    extra = (_url, init) =>
      init?.method === 'PUT' ? json(500, { message: 'Could not save order' }) : undefined;
    const lead = await panel('Lead');
    const bass = await panel('Bass');
    act(() => drag(bass, lead));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not save order'),
    );
    expect(order()).toEqual(['Lead', 'Alto', 'Bass']);
  });
});
