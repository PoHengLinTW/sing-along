import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../App';
import { AppProviders } from '../providers';
import { ToastProvider } from '../ui/toast';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ setOptions() {}, destroy() {} }) },
}));
vi.mock('../audio/useProjectAudio', () => ({ useProjectAudio: () => {} }));

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const track = {
  id: 1,
  projectId: 7,
  name: 'Lead',
  performer: null,
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 1000,
  mimeType: 'audio/flac',
  sizeBytes: 1,
  source: 'upload',
  sortOrder: 0,
  peaks: [0.5],
  createdAt: '',
};
const project = (tracks: unknown[]) => ({
  id: 7,
  title: 'Amazing Grace',
  artist: null,
  notes: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  tracks,
});

function setup(handler: (url: string) => Response | Promise<Response>) {
  const f = vi.fn(async (url: string) => handler(url));
  vi.stubGlobal('fetch', f);
  render(
    <AppProviders>
      <RouterProvider router={createAppRouter(['/project/7'])} />
    </AppProviders>,
  );
  return f;
}
const projectCalls = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter((c) => c[0] === '/api/projects/7').length;

describe('ProjectPage: load errors', () => {
  it('shows an error with Retry when the project cannot be loaded (server error)', async () => {
    let n = 0;
    const f = setup((url) => {
      if (url !== '/api/projects/7') return json(200, []);
      return ++n === 1 ? json(500, { message: 'boom' }) : json(200, project([track]));
    });
    expect(await screen.findByText(/couldn't load this project/i)).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Title')).toBeTruthy();
    expect(projectCalls(f)).toBe(2);
  });

  it('shows the same error when the server cannot be reached', async () => {
    let n = 0;
    setup((url) => {
      if (url !== '/api/projects/7') return json(200, []);
      if (++n === 1) throw new TypeError('Failed to fetch');
      return json(200, project([track]));
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Title')).toBeTruthy();
  });

  it('still shows "not found" for a 404, without a Retry', async () => {
    setup(() => json(404, { message: 'Project not found' }));
    expect(await screen.findByText(/project not found/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('ProjectPage: a failed refresh', () => {
  it('keeps showing the project instead of replacing it with the error page', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url !== '/api/projects/7') return json(200, []);
        return ++n === 1 ? json(200, project([track])) : json(500, { message: 'boom' });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ToastProvider>
        <QueryClientProvider client={client}>
          <RouterProvider router={createAppRouter(['/project/7'])} />
        </QueryClientProvider>
      </ToastProvider>,
    );
    await screen.findByLabelText('Title');
    await client.invalidateQueries({ queryKey: ['project', '7'] });
    await waitFor(() => expect(client.getQueryState(['project', '7'])?.status).toBe('error'));
    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(screen.queryByText(/couldn't load this project/i)).toBeNull();
  });
});

describe('ProjectPage: empty project', () => {
  const load = (tracks: unknown[]) =>
    setup((url) => (url === '/api/projects/7' ? json(200, project(tracks)) : json(200, [])));

  it('offers Upload a track and Record when there are no tracks', async () => {
    load([]);
    expect(await screen.findByText(/no tracks yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload a track' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record a take' })).toBeTruthy();
  });

  it('is gone once the project has a track', async () => {
    load([track]);
    await screen.findByLabelText('Title');
    expect(screen.queryByText(/no tracks yet/i)).toBeNull();
  });

  it('Upload a track opens the file chooser', async () => {
    load([]);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    await userEvent.click(await screen.findByRole('button', { name: 'Upload a track' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLInputElement).type).toBe('file');
    click.mockRestore();
  });

  it('Record starts the same recording flow as the transport bar button', async () => {
    load([]);
    const transportRecord = await screen.findByRole('button', { name: 'Record' });
    const clicked = vi.fn();
    transportRecord.addEventListener('click', clicked);
    await userEvent.click(screen.getByRole('button', { name: 'Record a take' }));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
  });
});
