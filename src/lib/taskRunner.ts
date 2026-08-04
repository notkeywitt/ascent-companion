/**
 * A tiny scheduler for background work the user fires off from a page: keyed
 * serialization plus a global parallelism cap.
 *
 *   - Tasks sharing a key run STRICTLY ONE AT A TIME, in submission order.
 *   - Tasks with different keys run in parallel, at most `maxParallel` at once.
 *
 * Built for the Tracking Sheet page, where the key is the ProjectID: a job's
 * Finalize reads the CURRENT INVOICE column that its own Sync rewrites, so those
 * two must never overlap — while different jobs touch different spreadsheets and
 * are free to go at once.
 *
 * A rejected task never blocks the tasks queued behind it, and `run` resolves
 * (rather than rejecting) so a caller that only reports status can't produce an
 * unhandled rejection. Each task's own outcome is reported through the
 * callbacks passed to it.
 */
export interface TaskRunner {
  /** Queue `fn` under `key`. Resolves when the task settles, never rejects. */
  run(key: string, fn: () => Promise<void>): Promise<void>;
  /** How many tasks are executing right now (for tests/diagnostics). */
  active(): number;
}

export function createTaskRunner(maxParallel: number): TaskRunner {
  if (!Number.isInteger(maxParallel) || maxParallel < 1) {
    throw new Error(`maxParallel must be a positive integer, got ${maxParallel}`);
  }

  const chains = new Map<string, Promise<void>>();
  const waiters: (() => void)[] = [];
  let inFlight = 0;

  async function withSlot(fn: () => Promise<void>): Promise<void> {
    if (inFlight >= maxParallel) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    inFlight += 1;
    try {
      await fn();
    } finally {
      inFlight -= 1;
      // Hand the slot to the next waiter, if any.
      waiters.shift()?.();
    }
  }

  return {
    run(key: string, fn: () => Promise<void>): Promise<void> {
      const prior = chains.get(key) ?? Promise.resolve();
      // `.catch` before chaining: a failed predecessor must not cancel its
      // successors, and the chain we store must always be a settled-not-rejected
      // promise so it can be awaited again safely.
      const next = prior.then(() => withSlot(fn)).catch(() => {});
      chains.set(key, next);
      // Drop the chain once it drains, so keys don't accumulate forever.
      next.then(() => {
        if (chains.get(key) === next) chains.delete(key);
      });
      return next;
    },
    active() {
      return inFlight;
    },
  };
}
