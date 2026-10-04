import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartTimeControl } from './StartTimeControl';

const onChange = vi.fn();
const onPreview = vi.fn();

beforeEach(() => {
  onChange.mockClear();
  onPreview.mockClear();
});

const show = (value = 12_350, home = 12_000) =>
  render(<StartTimeControl value={value} home={home} onChange={onChange} onPreview={onPreview} />);
const field = () => screen.getByRole('textbox', { name: 'Start time' }) as HTMLInputElement;

describe('StartTimeControl', () => {
  it('shows the start as mm:ss.mmm', () => {
    show();
    expect(field().value).toBe('00:12.350');
  });

  it('commits a typed time on Enter', () => {
    show();
    fireEvent.change(field(), { target: { value: '0:12.2' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(12_200);
  });

  it('commits a typed time on blur', () => {
    show();
    fireEvent.change(field(), { target: { value: '15' } });
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith(15_000);
  });

  it('puts an unreadable entry back and flags it', () => {
    show();
    fireEvent.change(field(), { target: { value: 'soon' } });
    expect(field().getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(field());
    expect(onChange).not.toHaveBeenCalled();
    expect(field().value).toBe('00:12.350');
    expect(field().getAttribute('aria-invalid')).toBe('false');
  });

  it('nudges with buttons: 10 ms and 100 ms, earlier and later', () => {
    show();
    for (const [name, expected] of [
      ['Start 100 ms earlier', 12_250],
      ['Start 10 ms earlier', 12_340],
      ['Start 10 ms later', 12_360],
      ['Start 100 ms later', 12_450],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(onChange).toHaveBeenLastCalledWith(expected);
    }
  });

  it('nudges with the arrow keys in the field: 10 ms, Shift 100 ms', () => {
    show();
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(12_360);
    fireEvent.keyDown(field(), { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(12_250);
  });

  it('can be reset to the original start, and the reset is disabled there', () => {
    const { rerender } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Reset start time' }));
    expect(onChange).toHaveBeenCalledWith(12_000);
    rerender(
      <StartTimeControl value={12_000} home={12_000} onChange={onChange} onPreview={onPreview} />,
    );
    expect(
      (screen.getByRole('button', { name: 'Reset start time' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('follows an outside change (a drag, a reload) unless the user is typing', () => {
    const { rerender } = show();
    rerender(<StartTimeControl value={20_000} home={12_000} onChange={onChange} />);
    expect(field().value).toBe('00:20.000');
  });

  it('shows a start before zero with a sign', () => {
    show(-150, 0);
    expect(field().value).toBe('-00:00.150');
  });

  it('has a "loop around here" preview button', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /loop around here/i }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('says nothing about delay or latency', () => {
    const { container } = show();
    expect(container.textContent?.toLowerCase()).not.toMatch(/latency|delay/);
    expect(container.innerHTML.toLowerCase()).not.toMatch(/latency|delay/);
  });
});
