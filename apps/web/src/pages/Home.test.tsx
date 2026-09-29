import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { AppProviders } from '../providers';

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function stubApi(handler: Handler) {
  const f = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', f);
  return f;
}
function renderHome(path = '/') {
  const router = createAppRouter([path]);
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const item = (over = {}) => ({
  id: 1,
  title: 'Amazing Grace',
  artist: 'Trad.',
  trackCount: 3,
  updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  ...over,
});

describe('Home: project list', () => {
  it('shows title, artist, track count and relative time; clicking opens the project', async () => {
    stubApi((url) =>
      url === '/api/projects'
        ? json(200, [item(), item({ id: 2, title: 'Solo', artist: null, trackCount: 1 })])
        : json(404, { message: 'x' }),
    );
    const router = renderHome();
    const row = (await screen.findByRole('link', { name: /Amazing Grace/ })) as HTMLAnchorElement;
    expect(within(row).getByText('Trad.')).toBeTruthy();
    expect(within(row).getByText('3 tracks')).toBeTruthy();
    expect(within(row).getByText('2 hours ago')).toBeTruthy();
    expect(within(screen.getByRole('link', { name: /Solo/ })).getByText('1 track')).toBeTruthy();
    await userEvent.click(row);
    expect(router.state.location.pathname).toBe('/project/1');
  });

  it('shows an empty state with a create call to action', async () => {
    stubApi(() => json(200, []));
    renderHome();
    expect(await screen.findByText(/no projects yet/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create your first project' }));
    expect(screen.getByRole('dialog', { name: /create project/i })).toBeTruthy();
  });

  it('shows skeleton rows while loading', () => {
    stubApi(() => new Promise(() => {})); // never resolves
    renderHome();
    expect(screen.getByRole('list', { name: /projects/i }).getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error state with a retry button that refetches', async () => {
    let calls = 0;
    stubApi(() => (++calls === 1 ? json(500, { message: 'boom' }) : json(200, [item()])));
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /Amazing Grace/ })).toBeTruthy();
    expect(calls).toBe(2);
  });
});

describe('Home: create project', () => {
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Create project' }));
    return screen.getByRole('dialog', { name: /create project/i });
  };

  it('validates the title (required, at most 200) without calling the API', async () => {
    const f = stubApi(() => json(200, [item()]));
    renderHome();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByText('Title is required')).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'a'.repeat(201));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByText(/at most 200/)).toBeTruthy();
    expect(
      f.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('creates the project and navigates to it', async () => {
    const f = stubApi((url, init) => {
      if (init?.method === 'POST')
        return json(201, {
          id: 42,
          title: 'New',
          artist: 'A',
          notes: null,
          tracks: [],
          createdAt: '',
          updatedAt: '',
        });
      return url === '/api/projects'
        ? json(200, [item()])
        : json(200, {
            id: 42,
            title: 'New',
            artist: null,
            notes: null,
            tracks: [],
            createdAt: '',
            updatedAt: '',
          });
    });
    const router = renderHome();
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText('Title'), '  New  ');
    await userEvent.type(within(dialog).getByLabelText('Artist'), 'A');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/project/42'));
    const post = f.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(((post as unknown[])[1] as RequestInit).body as string)).toEqual({
      title: 'New',
      artist: 'A',
    });
  });

  it('shows a server-side field error under the title', async () => {
    stubApi((_url, init) =>
      init?.method === 'POST'
        ? json(400, { message: 'Title is required', fields: { title: 'Server says no' } })
        : json(200, [item()]),
    );
    renderHome();
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'ok');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Server says no')).toBeTruthy();
  });
});
