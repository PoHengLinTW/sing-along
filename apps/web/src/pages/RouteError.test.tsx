import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteError } from './RouteError';

afterEach(() => vi.restoreAllMocks());

function Crash(): never {
  throw new Error('kaboom internal detail');
}

describe('RouteError', () => {
  it('replaces a crashed page with a message and a way out, without technical details', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter(
      [{ path: '/', element: <Crash />, errorElement: <RouteError /> }],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(
      (screen.getByRole('link', { name: /projects/i }) as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/');
    expect(document.body.textContent).not.toContain('kaboom');
  });
});
