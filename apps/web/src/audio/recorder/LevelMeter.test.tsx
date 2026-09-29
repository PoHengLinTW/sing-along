import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LevelMeter } from './LevelMeter';
import { createLevelStore, feedLevel } from './levelStore';
import { saveMicDevice } from './mic';
import { createRecordingStore } from './recordingStore';

let levels: ReturnType<typeof createLevelStore>;
let recording: ReturnType<typeof createRecordingStore>;
const monitor = { start: vi.fn(async () => {}), stop: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  levels = createLevelStore();
  recording = createRecordingStore();
  monitor.start.mockClear();
  monitor.stop.mockClear();
  render(<LevelMeter levels={levels} recording={recording} monitor={monitor as never} />);
});
afterEach(() => vi.useRealTimers());

const block = (peak: number) => ({ min: -peak, max: peak, frames: 1024 });

describe('LevelMeter', () => {
  it('shows the input level as a meter', () => {
    act(() => feedLevel(levels, block(0.5)));
    const meter = screen.getByRole('meter', { name: /input level/i }) as HTMLMeterElement;
    expect(meter.value).toBeCloseTo(0.9, 1);
    expect(meter.getAttribute('aria-valuetext')).toBe('-6 dB');
  });

  it('warns about clipping for 2 s and then goes away', () => {
    expect(screen.queryByText(/clipping/i)).toBeNull();
    act(() => feedLevel(levels, block(1)));
    expect(screen.getByText(/clipping/i)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(screen.getByText(/clipping/i)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText(/clipping/i)).toBeNull();
  });

  it('does not warn for a loud but unclipped level', () => {
    act(() => feedLevel(levels, block(0.9)));
    expect(screen.queryByText(/clipping/i)).toBeNull();
  });

  it('works before recording: "Check input level" opens the mic monitor on the saved device', async () => {
    saveMicDevice('usb-1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /check input level/i }));
    });
    expect(monitor.start).toHaveBeenCalledWith('usb-1');
    act(() => levels.setState({ monitoring: true }));
    fireEvent.click(screen.getByRole('button', { name: /stop checking/i }));
    expect(monitor.stop).toHaveBeenCalled();
  });

  it('the check button is unavailable while recording (the take is already metering)', () => {
    act(() => recording.setState({ status: 'recording' }));
    expect(
      (screen.getByRole('button', { name: /check input level/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows a mic failure from the check', async () => {
    monitor.start.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /check input level/i }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/allow.*settings/i);
  });
});
