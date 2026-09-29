import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyedDebouncer } from './debounce';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('KeyedDebouncer', () => {
  it('runs a scheduled job once, after the quiet period', () => {
    const d = new KeyedDebouncer(500);
    const job = vi.fn();
    d.schedule(1, job);
    vi.advanceTimersByTime(499);
    expect(job).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('each new schedule for a key restarts the wait and replaces the job', () => {
    const d = new KeyedDebouncer(500);
    const first = vi.fn();
    const second = vi.fn();
    d.schedule(1, first);
    vi.advanceTimersByTime(400);
    d.schedule(1, second);
    vi.advanceTimersByTime(400);
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keys are independent', () => {
    const d = new KeyedDebouncer(500);
    const a = vi.fn();
    const b = vi.fn();
    d.schedule('a', a);
    d.schedule('b', b);
    vi.advanceTimersByTime(500);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('flushAll runs pending jobs now and nothing runs twice', () => {
    const d = new KeyedDebouncer(500);
    const job = vi.fn();
    d.schedule(1, job);
    d.flushAll();
    expect(job).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a pending job', () => {
    const d = new KeyedDebouncer(500);
    const job = vi.fn();
    d.schedule(1, job);
    d.cancel(1);
    vi.advanceTimersByTime(1000);
    expect(job).not.toHaveBeenCalled();
  });
});
