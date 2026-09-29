import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LatencyControl } from './LatencyControl';

const onChange = vi.fn();
const onPreview = vi.fn();

beforeEach(() => {
  onChange.mockClear();
  onPreview.mockClear();
});

const show = (value = 0) =>
  render(<LatencyControl value={value} onChange={onChange} onPreview={onPreview} />);

describe('LatencyControl', () => {
  it('has a +-1000 ms slider in 1 ms steps', () => {
    show(25);
    const slider = screen.getByRole('slider', { name: /latency offset/i }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual([
      '-1000',
      '1000',
      '1',
      '25',
    ]);
    fireEvent.change(slider, { target: { value: '-120' } });
    expect(onChange).toHaveBeenCalledWith(-120);
  });

  it('arrow keys nudge by 1 ms and Shift+arrow by 10 ms', () => {
    show(100);
    const slider = screen.getByRole('slider', { name: /latency offset/i });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(101);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(99);
    fireEvent.keyDown(slider, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(110);
    fireEvent.keyDown(slider, { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(90);
  });

  it('nudges stay inside the range', () => {
    show(1000);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(1000);
  });

  it('accepts an exact value in the number field, clamped to the range', () => {
    show(0);
    const field = screen.getByRole('spinbutton', { name: /latency offset \(ms\)/i });
    fireEvent.change(field, { target: { value: '-37' } });
    expect(onChange).toHaveBeenLastCalledWith(-37);
    fireEvent.change(field, { target: { value: '4000' } });
    expect(onChange).toHaveBeenLastCalledWith(1000);
  });

  it('ignores a half-typed value instead of jumping to 0', () => {
    show(12);
    const field = screen.getByRole('spinbutton');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.change(field, { target: { value: '-' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reset returns to 0 and is disabled when already 0', () => {
    const { rerender } = show(40);
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onChange).toHaveBeenCalledWith(0);
    rerender(<LatencyControl value={0} onChange={onChange} onPreview={onPreview} />);
    expect((screen.getByRole('button', { name: /reset/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('has a "loop around here" preview button', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /loop around here/i }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });
});
