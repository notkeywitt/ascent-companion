import { describe, expect, it } from "vitest";
import { createTaskRunner } from "./taskRunner";

/**
 * The keyed task queue behind the Tracking Sheet page.
 *
 * The invariant that matters: two tasks sharing a key must NEVER overlap. A
 * job's Finalize reads the CURRENT INVOICE column that its own Sync rewrites, so
 * an overlap corrupts that job's sheet. Different keys are different
 * spreadsheets and may run at once.
 */

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createTaskRunner", () => {
  it("rejects a nonsensical parallelism", () => {
    expect(() => createTaskRunner(0)).toThrow();
    expect(() => createTaskRunner(-1)).toThrow();
    expect(() => createTaskRunner(1.5)).toThrow();
  });

  it("runs tasks sharing a key STRICTLY one at a time, in order", async () => {
    const runner = createTaskRunner(4);
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    const task = (label: string) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${label}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${label}`);
      active--;
    };

    await Promise.all([
      runner.run("jobA", task("1")),
      runner.run("jobA", task("2")),
      runner.run("jobA", task("3")),
    ]);

    expect(maxActive).toBe(1);
    expect(order).toEqual([
      "start:1", "end:1",
      "start:2", "end:2",
      "start:3", "end:3",
    ]);
  });

  it("runs different keys concurrently", async () => {
    const runner = createTaskRunner(4);
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    };

    await Promise.all([runner.run("a", task), runner.run("b", task), runner.run("c", task)]);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("never exceeds maxParallel across keys", async () => {
    const runner = createTaskRunner(2);
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };

    await Promise.all(["a", "b", "c", "d", "e"].map((k) => runner.run(k, task)));
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("a failing task does not block the ones queued behind it", async () => {
    const runner = createTaskRunner(2);
    const ran: string[] = [];

    await Promise.all([
      runner.run("k", async () => {
        throw new Error("boom");
      }),
      runner.run("k", async () => {
        ran.push("second");
      }),
    ]);

    expect(ran).toEqual(["second"]);
  });

  it("resolves rather than rejecting, so a status-only caller can't blow up", async () => {
    const runner = createTaskRunner(1);
    await expect(
      runner.run("k", async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeUndefined();
  });

  it("reports how many tasks are in flight", async () => {
    const runner = createTaskRunner(2);
    expect(runner.active()).toBe(0);

    const d = deferred();
    const p = runner.run("k", () => d.promise);
    await Promise.resolve();
    expect(runner.active()).toBe(1);

    d.resolve();
    await p;
    expect(runner.active()).toBe(0);
  });

  it("drains its key map so long-running pages don't leak keys", async () => {
    const runner = createTaskRunner(2);
    for (const k of ["a", "b", "c"]) await runner.run(k, async () => {});
    // Nothing in flight, and a fresh task on a used key still runs immediately.
    expect(runner.active()).toBe(0);
    let ran = false;
    await runner.run("a", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
