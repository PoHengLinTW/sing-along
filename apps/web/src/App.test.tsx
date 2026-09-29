import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from './App';
import { AppProviders } from './providers';

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderAt(path: string) {
  const router = createAppRouter([path]);
  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe('routing', () => {
  it('shows a 404 page for unknown routes, with a link home', async () => {
    renderAt('/nope/nothing');
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/');
  });

  it('shows "Project not found" with a link home when the API says 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(404, { message: 'Project not found' })),
    );
    renderAt('/project/123');
    expect(await screen.findByRole('heading', { name: /project not found/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/');
  });

  it('toasts API errors that are not "not found", with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(500, { message: 'Something went wrong on the server.' })),
    );
    renderAt('/project/1');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Something went wrong'),
    );
  });

  it('toasts "Can\'t reach server." on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderAt('/project/1');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain("Can't reach server."),
    );
  });
});
