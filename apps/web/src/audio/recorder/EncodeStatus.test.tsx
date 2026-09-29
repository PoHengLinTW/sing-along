import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EncodeStatus } from './EncodeStatus';
import { createEncodeStore } from './encodeStore';

let state: ReturnType<typeof createEncodeStore>;
const retry = vi.fn();
beforeEach(() => {
  state = createEncodeStore();
  retry.mockClear();
  render(<EncodeStatus state={state} onRetry={retry} names={{ a: 'Take 1' }} />);
});

describe('EncodeStatus', () => {
  it('renders nothing when idle', () => {
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows a progress indicator while a take is encoding', () => {
    act(() => state.getState().start('a'));
    act(() => state.getState().progress('a', 0.43));
    const bar = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(bar.value).toBeCloseTo(0.43);
    expect(screen.getByText(/encoding take 1/i)).toBeTruthy();
  });

  it('offers a retry after a failure', () => {
    act(() => state.getState().fail('a', 'boom'));
    expect(screen.getByRole('alert').textContent).toMatch(/boom/);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledWith('a');
  });

  it('shows the WAV fallback notice until dismissed', () => {
    act(() => state.getState().setNotice('Saved as WAV'));
    expect(screen.getByRole('status').textContent).toMatch(/wav/i);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
