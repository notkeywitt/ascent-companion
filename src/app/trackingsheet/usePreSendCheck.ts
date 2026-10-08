"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreSendResult } from "@/lib/invoiceReview/preSend";
import { createTaskRunner } from "@/lib/taskRunner";
import {
  checkedAtLabel,
  clearFinding,
  isOpen,
  mergeRun,
  readChecks,
  unclearAll,
  writeCheck,
  type JobCheckMemory,
} from "./preSendMemory";

/** One job's check. Throws with the route's error. Also run per job by "Check all Jobs". */
export async function fetchPreSend(jobId: string, ym: string): Promise<PreSendResult> {
  const res = await fetch(
    `/api/invoice-review/job?jobId=${encodeURIComponent(jobId)}&ym=${encodeURIComponent(ym)}`,
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "The check failed.");
  return json as PreSendResult;
}

/** One job's check as it stands on screen. */
export interface JobRun {
  /** The last run plus what the office did to it — see preSendMemory.ts. */
  mem: JobCheckMemory | null;
  state: "idle" | "queued" | "running";
  error: string;
  /** The finding whose Re-check is running; "" while the whole job is. */
  recheckKey: string;
  /** Per finding, what its last Re-check found ("Still there · 2:14 pm"). */
  notes: Record<string, string>;
}

const IDLE: JobRun = { mem: null, state: "idle", error: "", recheckKey: "", notes: {} };

/**
 * The job checks behind "Check this job" (one job) and "Check all Jobs" (every
 * job with cost). Same route, same checks; what this adds is MEMORY: each run
 * is laid over the last one and kept in the browser (preSendMemory.ts), so a
 * finding fixed since shows as fixed, a cleared one stays cleared, and leaving
 * for the board to fix something does not throw the list away.
 *
 * A Re-check on one row re-runs that row's whole job — the route checks a job,
 * not a finding — and reports on the row whether its finding is still there.
 *
 * Three jobs at a time: each check is several JobTread round trips, and firing
 * a whole month at once only queues them behind the rate limit.
 */
export function useJobChecks(ym: string, jobIds: string[]) {
  const [runs, setRuns] = useState<Record<string, JobRun>>({});
  /** The memory, read synchronously — a run lays its result over the latest. */
  const mems = useRef<Record<string, JobCheckMemory>>({});
  /** Bumped by a month change, so a check still in flight from the old month
   *  cannot write into the new one. */
  const gen = useRef(0);
  /** The jobs of the last "Check all", and those it has not finished — its
   *  n / total counter. A row's Re-check is not part of it. */
  const [batch, setBatch] = useState<string[]>([]);
  const [batchLeft, setBatchLeft] = useState<Set<string>>(new Set());

  const patch = useCallback((jobId: string, p: Partial<JobRun>) => {
    setRuns((prev) => ({ ...prev, [jobId]: { ...(prev[jobId] ?? IDLE), ...p } }));
  }, []);

  // Restore what this device last saw for these jobs and this month.
  const idsKey = jobIds.join(",");
  useEffect(() => {
    gen.current++;
    const stored = readChecks(idsKey ? idsKey.split(",") : [], ym);
    mems.current = stored;
    setBatch([]);
    setBatchLeft(new Set());
    setRuns(Object.fromEntries(Object.entries(stored).map(([id, mem]) => [id, { ...IDLE, mem }])));
  }, [ym, idsKey]);

  const commit = useCallback(
    (jobId: string, mem: JobCheckMemory) => {
      mems.current[jobId] = mem;
      writeCheck(jobId, ym, mem);
      return mem;
    },
    [ym],
  );

  /** Run one job's check. With `key`, it is that finding's Re-check. */
  const check = useCallback(
    async (jobId: string, key = "") => {
      const g = gen.current;
      patch(jobId, { state: "running", error: "", recheckKey: key });
      try {
        const fresh = await fetchPreSend(jobId, ym);
        if (g !== gen.current) return;
        const at = new Date().toISOString();
        const mem = commit(jobId, mergeRun(mems.current[jobId] ?? null, fresh, at));
        setRuns((prev) => {
          const cur = prev[jobId] ?? IDLE;
          // A whole-job run starts the notes over; a Re-check adds its one.
          const notes = key ? { ...cur.notes } : {};
          // "Still there" only when THIS run found it — an incomplete run
          // carries an unfound finding over, and that is not a finding.
          const found = fresh.findings.some((f) => f.key === key);
          if (key && found && isOpen(mem, key)) notes[key] = `Still there · ${checkedAtLabel(at)}`;
          else if (key && fresh.evidenceWarnings.length) {
            notes[key] = "Not confirmed — the check could not read the whole job";
          } else if (key) delete notes[key];
          return { ...prev, [jobId]: { ...cur, mem, state: "idle", recheckKey: "", notes } };
        });
      } catch (e) {
        if (g !== gen.current) return;
        patch(jobId, {
          state: "idle",
          recheckKey: "",
          error: e instanceof Error ? e.message : "The check failed.",
        });
      }
    },
    [ym, patch, commit],
  );

  /** "Check all Jobs" — every job given, three at a time. */
  const checkAll = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const g = gen.current;
      setBatch(ids);
      setBatchLeft(new Set(ids));
      for (const id of ids) patch(id, { state: "queued", error: "" });
      const runner = createTaskRunner(3);
      for (const id of ids) {
        void runner.run(id, async () => {
          await check(id);
          if (g !== gen.current) return; // the month changed under it
          setBatchLeft((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        });
      }
    },
    [check, patch],
  );

  const clear = useCallback(
    (jobId: string, key: string) => {
      const cur = mems.current[jobId];
      if (!cur) return;
      const mem = commit(jobId, clearFinding(cur, key));
      setRuns((prev) => {
        const run = prev[jobId] ?? IDLE;
        const notes = { ...run.notes };
        delete notes[key];
        return { ...prev, [jobId]: { ...run, mem, notes } };
      });
    },
    [commit],
  );

  const unclear = useCallback(
    (jobId: string) => {
      const cur = mems.current[jobId];
      if (cur) patch(jobId, { mem: commit(jobId, unclearAll(cur)) });
    },
    [commit, patch],
  );

  return {
    runs,
    check,
    checkAll,
    clear,
    unclear,
    /** A "Check all" is still working through its jobs. */
    batchRunning: batchLeft.size > 0,
    finished: batch.length - batchLeft.size,
    total: batch.length,
  };
}

/**
 * "Check this job" on the Tracking Sheets board — the invoice review's checks,
 * run on one job and month. Moved out of Board.tsx on 2026-09-29
 * (SIMPLICITY_AUDIT.md finding 01); since 2026-10-08 a one-job view of
 * useJobChecks, so the board and "Check all Jobs" share one memory.
 */
export function usePreSendCheck({ jobId, ym }: { jobId: string; ym: string }) {
  const jc = useJobChecks(ym, jobId ? [jobId] : []);
  const run = (jobId && jc.runs[jobId]) || IDLE;
  const { check, clear, unclear } = jc;
  return {
    preSend: run,
    preSendRunning: run.state !== "idle",
    runPreSend: useCallback(() => (jobId ? void check(jobId) : undefined), [jobId, check]),
    recheck: useCallback(
      (key: string) => (jobId ? void check(jobId, key) : undefined),
      [jobId, check],
    ),
    clear: useCallback((key: string) => (jobId ? clear(jobId, key) : undefined), [jobId, clear]),
    unclear: useCallback(() => (jobId ? unclear(jobId) : undefined), [jobId, unclear]),
  };
}
