import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './toast';

function Trigger({ text }: { text: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.error(text)}>
      fire
    </button>
  );
}

describe('toasts', () => {
  it('shows an error message in an alert region and can be dismissed', async () => {
    render(
      <ToastProvider>
        <Trigger text="Title is required" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('fire'));
    expect(screen.getByRole('alert').textContent).toContain('Title is required');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('auto-dismisses after a few seconds', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger text="Oops" />
      </ToastProvider>,
    );
    await act(async () => {
      screen.getByText('fire').click();
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    vi.useRealTimers();
  });
});
