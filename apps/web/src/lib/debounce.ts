/** Debounces jobs per key: only the latest job of a key runs, once its key has been quiet for `delayMs`. */
export class KeyedDebouncer {
  private pending = new Map<
    string | number,
    { timer: ReturnType<typeof setTimeout>; job: () => void }
  >();

  constructor(private delayMs: number) {}

  schedule(key: string | number, job: () => void): void {
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      job();
    }, this.delayMs);
    this.pending.set(key, { timer, job });
  }

  cancel(key: string | number): void {
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    this.pending.delete(key);
  }

  /** Runs every pending job now (leaving the page must not lose the last edit). */
  flushAll(): void {
    const jobs = [...this.pending.values()];
    for (const { timer } of jobs) clearTimeout(timer);
    this.pending.clear();
    for (const { job } of jobs) job();
  }
}
