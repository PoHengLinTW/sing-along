import { describe, expect, it, vi } from 'vitest';
import { createLevelStore } from './levelStore';
import { InputMonitor } from './monitor';

function setup() {
  const store = createLevelStore();
  const rec = { open: vi.fn(async () => {}), close: vi.fn() };
  let onLevel: (l: { min: number; max: number; frames: number; capturing: boolean }) => void =
    () => {};
  const monitor = new InputMonitor({
    createRecorder: (cb) => {
      onLevel = cb;
      return rec as never;
    },
    levels: store,
  });
  return { store, rec, monitor, emit: (l: Parameters<typeof onLevel>[0]) => onLevel(l) };
}

describe('InputMonitor', () => {
  it('opens the mic on the chosen device and reports levels into the store', async () => {
    const { store, rec, monitor, emit } = setup();
    await monitor.start('dev-1');
    expect(rec.open).toHaveBeenCalledWith('dev-1');
    expect(store.getState().monitoring).toBe(true);
    emit({ min: -0.4, max: 0.5, frames: 1024, capturing: false });
    expect(store.getState().level).toBe(0.5);
  });

  it('stop releases the mic and zeroes the meter', async () => {
    const { store, rec, monitor, emit } = setup();
    await monitor.start(null);
    emit({ min: -1, max: 1, frames: 1024, capturing: false });
    monitor.stop();
    expect(rec.close).toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ monitoring: false, level: 0, clipUntil: 0 });
  });

  it('start twice keeps one open mic', async () => {
    const { rec, monitor } = setup();
    await monitor.start(null);
    await monitor.start(null);
    expect(rec.open).toHaveBeenCalledTimes(1);
  });

  it('a failed open leaves the monitor off and rethrows', async () => {
    const { store, rec, monitor } = setup();
    rec.open.mockRejectedValueOnce(new Error('denied'));
    await expect(monitor.start(null)).rejects.toThrow('denied');
    expect(store.getState().monitoring).toBe(false);
  });

  it('stop is a no-op when not monitoring', () => {
    const { rec, monitor } = setup();
    monitor.stop();
    expect(rec.close).not.toHaveBeenCalled();
  });
});
