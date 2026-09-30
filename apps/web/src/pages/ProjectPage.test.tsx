import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { AppProviders } from '../providers';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
vi.mock('../audio/useProjectAudio', () => ({ useProjectAudio: () => {} }));

afterEach(() => vi.unstubAllGlobals());

const fullTrack = (id: number) => ({
  id,
  projectId: 7,
  name: `Track ${id}`,
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const project = (over = {}) => ({
  id: 7,
  title: 'Amazing Grace',
  artist: 'Trad.',
  notes: 'Key of G',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  tracks: [fullTrack(1), fullTrack(2), fullTrack(3)],
  ...over,
});

function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const f = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', f);
  const router = createAppRouter(['/project/7']);
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { f, router };
}
const patches = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([url, init]) => ({ url, body: JSON.parse((init as RequestInit).body as string) }));

describe('project header: inline edit', () => {
  it('keeps timeline zoom controls with the track heading', async () => {
    setup(() => json(200, project()));
    await screen.findByLabelText('Title');
    const heading = document.querySelector('.workspace-heading');
    expect(heading).toBeTruthy();
    expect(within(heading as HTMLElement).getByRole('button', { name: 'Zoom in' })).toBeTruthy();
  });

  const api = (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return json(200, project(JSON.parse(init.body as string)));
    return json(200, project());
  };

  it('saves the title on blur and shows Saved', async () => {
    const { f } = setup(api);
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'New Title');
    await userEvent.tab();
    await waitFor(() =>
      expect(patches(f)).toEqual([{ url: '/api/projects/7', body: { title: 'New Title' } }]),
    );
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('saves artist on Enter, and notes only on blur', async () => {
    const { f } = setup(api);
    const artist = await screen.findByLabelText('Artist');
    await userEvent.type(artist, ' & co{Enter}');
    await waitFor(() => expect(patches(f)).toHaveLength(1));
    expect(patches(f)[0]?.body).toEqual({ artist: 'Trad. & co' });
    const notes = screen.getByLabelText('Notes');
    await userEvent.type(notes, '{Enter}more');
    expect(patches(f)).toHaveLength(1);
    await userEvent.tab();
    await waitFor(() => expect(patches(f)).toHaveLength(2));
  });

  it('clearing the title shows a validation error and does not save', async () => {
    const { f } = setup(api);
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.tab();
    expect(await screen.findByText('Title is required')).toBeTruthy();
    expect(patches(f)).toHaveLength(0);
  });

  it('Esc undoes an edit', async () => {
    const { f } = setup(api);
    const title = (await screen.findByLabelText('Title')) as HTMLInputElement;
    await userEvent.type(title, 'zzz{Escape}');
    expect(title.value).toBe('Amazing Grace');
    expect(patches(f)).toHaveLength(0);
  });
});

describe('project header: delete', () => {
  it('asks to type the project title, with the track count in the message', async () => {
    setup(() => json(200, project()));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete project' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText("Delete 'Amazing Grace' and its 3 tracks? This cannot be undone."),
    ).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(within(dialog).getByRole('textbox'), 'Amazing Grace');
    expect(confirm.disabled).toBe(false);
  });

  it('uses the singular for one track', async () => {
    setup(() => json(200, project({ tracks: [fullTrack(1)] })));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete project' }));
    expect(
      screen.getByText("Delete 'Amazing Grace' and its 1 track? This cannot be undone."),
    ).toBeTruthy();
  });

  it('deletes, goes home, and the project is gone from the list', async () => {
    let deleted = false;
    const { f, router } = setup((url, init) => {
      if (init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/projects')
        return json(
          200,
          deleted
            ? []
            : [
                {
                  id: 7,
                  title: 'Amazing Grace',
                  artist: null,
                  trackCount: 3,
                  updatedAt: '2026-01-01T00:00:00Z',
                },
              ],
        );
      return json(200, project());
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete project' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Amazing Grace');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText(/no projects yet/i)).toBeTruthy();
    expect(
      f.mock.calls.some(
        ([url, init]) =>
          url === '/api/projects/7' && (init as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
