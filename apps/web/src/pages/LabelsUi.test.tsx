import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { mixerStore } from '../audio/mixerStore';
import { AppProviders } from '../providers';

const wsCreates = vi.hoisted(() => [] as Record<string, unknown>[]);
const audioTracks = vi.hoisted(() => ({ last: [] as { id: number }[] }));
vi.mock('wavesurfer.js', () => ({
  default: {
    create: (opts: Record<string, unknown>) => {
      wsCreates.push(opts);
      return { setOptions() {}, destroy() {} };
    },
  },
}));
vi.mock('../audio/useProjectAudio', () => ({
  useProjectAudio: (tracks: { id: number }[]) => {
    audioTracks.last = tracks;
  },
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const L = {
  alto: { id: 1, name: 'Alto', color: '#f97316', isPreset: true },
  bass: { id: 2, name: 'Bass', color: '#22c55e', isPreset: true },
  lead: { id: 3, name: 'Lead', color: '#ef4444', isPreset: true },
};
const mkTrack = (id: number, name: string, labels: (typeof L)[keyof typeof L][]) => ({
  id,
  projectId: 7,
  name,
  performer: null,
  labels,
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

let project: ReturnType<typeof makeProject>;
const makeProject = () => ({
  id: 7,
  title: 'Song',
  artist: null,
  notes: null,
  createdAt: '',
  updatedAt: '',
  tracks: [
    mkTrack(1, 'Lead vox', [L.lead]),
    mkTrack(2, 'Alto 1', [L.alto]),
    mkTrack(3, 'Alto 2', [L.alto, L.bass]),
    mkTrack(4, 'Bass', [L.bass]),
    mkTrack(5, 'Plain', []),
  ],
});
let f: ReturnType<typeof vi.fn>;
let extra: (url: string, init?: RequestInit) => Response | undefined;

beforeEach(() => {
  mixerStore.getState().reset();
  wsCreates.length = 0;
  extra = () => undefined;
  project = makeProject();
  f = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = extra(url, init);
    if (custom) return custom;
    if (url === '/api/labels') return json(200, [L.alto, L.bass, L.lead]);
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

const panelNames = () =>
  screen
    .queryAllByTestId(/^panel-/)
    .map((p) => p.getAttribute('data-testid')?.replace('panel-', ''));
const calls = (method: string) =>
  f.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
    .map(([url, init]) => ({
      url: url as string,
      body: (init as RequestInit).body
        ? JSON.parse((init as RequestInit).body as string)
        : undefined,
    }));

describe('chips and colors', () => {
  it('shows a colored chip per label on each track', async () => {
    const panel = await screen.findByTestId('panel-Alto 2');
    const chips = within(panel).getAllByTestId('label-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Alto', 'Bass']);
    expect(chips[0]?.style.background).not.toBe('');
  });

  it('colors each waveform from the first label (neutral without labels)', async () => {
    await screen.findByTestId('panel-Alto 2');
    const colorFor = (i: number) => wsCreates[i]?.waveColor;
    expect(colorFor(0)).toBe('#ef4444'); // Lead vox
    expect(colorFor(2)).toBe('#f97316'); // Alto 2: first label is Alto, not Bass
    expect(colorFor(4)).toBe('#94a3b8'); // Plain: no labels
  });
});

describe('editing a track’s labels', () => {
  it('opens the picker, saves the selection through PATCH, and updates the chips', async () => {
    extra = (_url, init) =>
      init?.method === 'PATCH'
        ? json(200, { ...project.tracks[4], labels: [L.lead, L.alto] })
        : undefined;
    const panel = await screen.findByTestId('panel-Plain');
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit labels for Plain' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Lead' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Alto' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1));
    expect(calls('PATCH')[0]).toEqual({ url: '/api/tracks/5', body: { labels: [3, 1] } });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('panel-Plain'))
          .getAllByTestId('label-chip')
          .map((c) => c.textContent),
      ).toEqual(['Lead', 'Alto']),
    );
  });

  it('creates a custom label from the picker and applies it', async () => {
    extra = (url, init) => {
      if (url === '/api/labels' && init?.method === 'POST')
        return json(201, { id: 50, name: 'Kazoo', color: '#0ea5e9', isPreset: false });
      if (init?.method === 'PATCH')
        return json(200, {
          ...project.tracks[4],
          labels: [{ id: 50, name: 'Kazoo', color: '#0ea5e9', isPreset: false }],
        });
      return undefined;
    };
    const panel = await screen.findByTestId('panel-Plain');
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit labels for Plain' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Find or create a label'), 'Kazoo');
    await userEvent.click(within(dialog).getByRole('button', { name: "Create 'Kazoo'" }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(calls('PATCH')[0]?.body).toEqual({ labels: [50] }));
    expect(calls('POST')[0]).toEqual({ url: '/api/labels', body: { name: 'Kazoo' } });
  });
});

describe('label filter', () => {
  const filterChip = (name: string) => screen.getByRole('button', { name: `Show only ${name}` });

  it('lists the labels used in the project', async () => {
    await screen.findByTestId('panel-Plain');
    for (const name of ['Lead', 'Alto', 'Bass']) expect(filterChip(name)).toBeTruthy();
  });

  it('hides tracks without the chosen label (panels and waveforms), and clearing shows all', async () => {
    await screen.findByTestId('panel-Plain');
    await userEvent.click(filterChip('Alto'));
    expect(panelNames()).toEqual(['Alto 1', 'Alto 2']);
    expect(screen.queryByTestId('lane-1')).toBeNull();
    expect(screen.getByTestId('lane-2')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(panelNames()).toEqual(['Lead vox', 'Alto 1', 'Alto 2', 'Bass', 'Plain']);
  });

  it('several chosen labels show tracks with any of them', async () => {
    await screen.findByTestId('panel-Plain');
    await userEvent.click(filterChip('Lead'));
    await userEvent.click(filterChip('Bass'));
    expect(panelNames()).toEqual(['Lead vox', 'Alto 2', 'Bass']);
  });

  it('hidden tracks keep playing: they stay loaded and keep their mute state', async () => {
    await screen.findByTestId('panel-Plain');
    await userEvent.click(
      within(screen.getByTestId('panel-Bass')).getByRole('button', { name: 'Mute' }),
    );
    await userEvent.click(filterChip('Alto'));
    expect(panelNames()).not.toContain('Bass');
    expect(audioTracks.last.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]); // the engine still has every track
    expect(mixerStore.getState().get(4).muted).toBe(true); // Bass is still muted, and Alto 1 is not
    expect(mixerStore.getState().get(2).muted).toBe(false);
  });

  it('reordering is disabled while a filter is active', async () => {
    await screen.findByTestId('panel-Plain');
    await userEvent.click(filterChip('Alto'));
    expect(
      (
        within(screen.getByTestId('panel-Alto 1')).getByRole('button', {
          name: 'Move Alto 1 down',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe('bulk mute by label', () => {
  it('Mute all / Unmute all toggle every track with that label, even hidden ones', async () => {
    await screen.findByTestId('panel-Plain');
    await userEvent.click(screen.getByRole('button', { name: 'Show only Lead' })); // hides the Alto tracks
    await userEvent.click(screen.getByRole('button', { name: 'Mute all Alto' }));
    expect(mixerStore.getState().get(2).muted).toBe(true);
    expect(mixerStore.getState().get(3).muted).toBe(true);
    expect(mixerStore.getState().get(1).muted).toBe(false);
    expect(mixerStore.getState().get(4).muted).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Unmute all Alto' }));
    expect(mixerStore.getState().get(2).muted).toBe(false);
    expect(mixerStore.getState().get(3).muted).toBe(false);
  });
});
