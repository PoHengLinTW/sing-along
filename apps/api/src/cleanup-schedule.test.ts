import { describe, expect, it, vi } from 'vitest';
import { scheduleCleanup } from './cleanup-schedule';

describe('scheduleCleanup', () => {
  it('returns null when switched off', () => {
    expect(scheduleCleanup(null, async () => {}, { error: () => {} })).toBeNull();
  });

  it('schedules a job that runs the cleanup and logs, never throws, on failure', async () => {
    const error = vi.fn();
    const run = vi.fn().mockRejectedValue(new Error('storage down'));
    const job = scheduleCleanup('30 3 * * *', run, { error });
    expect(job?.nextRun()).toBeInstanceOf(Date);
    await job?.trigger();
    expect(run).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('storage down'));
    job?.stop();
  });
});
