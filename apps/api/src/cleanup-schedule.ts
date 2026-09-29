import { Cron } from 'croner';

/**
 * Runs `run` on the cron pattern (null = off). `protect` skips a tick while the previous run is
 * still going, and a failing run is logged instead of crashing the API.
 */
export function scheduleCleanup(
  pattern: string | null,
  run: () => Promise<unknown>,
  log: { error(message: string): void },
): Cron | null {
  if (!pattern) return null;
  return new Cron(pattern, { protect: true }, async () => {
    try {
      await run();
    } catch (err) {
      log.error(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
