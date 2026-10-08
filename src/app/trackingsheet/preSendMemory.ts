/**
 * WHAT A JOB CHECK REMEMBERS — "Check this job" and "Check all Jobs" share it.
 *
 * A check used to live only in React state, so every link out of the results
 * list threw the list away: open a labor finding on the board, come back, and
 * the month's results were gone. This keeps the last run per job and month in
 * the browser, plus two things the office does to it:
 *
 *   cleared  finding keys the office dismissed. Hidden on every later run of
 *            the same job and month, so "Check all Jobs again" does not bring
 *            back what was already looked at. NOT a ruling — it silences
 *            nothing in the monthly review, and it lives on this device only.
 *   fixed    findings a run showed and a later run no longer found. Kept on
 *            the list, marked fixed, until cleared — a row that simply vanished
 *            reads as "did it even run?".
 *
 * A run that could not read the whole job (evidence warnings) never marks
 * anything fixed: a finding missing from an incomplete run is carried over as
 * still open. A gate that could not read the job must never render as clean.
 *
 * Pure functions plus a thin localStorage layer (per-viewer; every access is
 * wrapped, because private mode and a full quota both throw). Pinned by
 * preSendMemory.test.ts.
 */
import type { Finding } from "@/lib/invoiceReview/types";
import type { PreSendResult } from "@/lib/invoiceReview/preSend";

export interface JobCheckMemory {
  /** The latest run, with any finding an incomplete run could not re-test carried over. */
  result: PreSendResult;
  /** ISO time of that run. */
  at: string;
  cleared: string[];
  fixed: Finding[];
}

/** The findings still to act on: not ruled out by the office, not cleared. */
export function openFindings(mem: JobCheckMemory): Finding[] {
  const cleared = new Set(mem.cleared);
  return mem.result.findings.filter((f) => !f.suppressedBy && !cleared.has(f.key));
}

/** "2 to fix, 1 to look at" — counted from what is still open. */
export function tally(mem: JobCheckMemory): { errors: number; warnings: number } {
  const open = openFindings(mem);
  return {
    errors: open.filter((f) => f.severity === "error").length,
    warnings: open.filter((f) => f.severity === "warning").length,
  };
}

/** How many open-looking findings the office cleared on this job and month. */
export function clearedCount(mem: JobCheckMemory): number {
  const keys = new Set(mem.cleared);
  return mem.result.findings.filter((f) => !f.suppressedBy && keys.has(f.key)).length;
}

/** Lay a fresh run over the last one. */
export function mergeRun(
  prev: JobCheckMemory | null,
  fresh: PreSendResult,
  at: string,
): JobCheckMemory {
  if (!prev) return { result: fresh, at, cleared: [], fixed: [] };

  const freshKeys = new Set(fresh.findings.map((f) => f.key));
  const cleared = new Set(prev.cleared);
  // What the office could see as open before this run, and this run did not find.
  const gone = prev.result.findings.filter(
    (f) => !f.suppressedBy && !cleared.has(f.key) && !freshKeys.has(f.key),
  );

  if (fresh.evidenceWarnings.length > 0) {
    // Not proof of a fix — the run could not read everything. Keep them open.
    return {
      result: { ...fresh, findings: [...fresh.findings, ...gone] },
      at,
      cleared: prev.cleared,
      fixed: prev.fixed.filter((f) => !freshKeys.has(f.key)),
    };
  }

  // A finding marked fixed that this run found again is open again.
  const fixed = prev.fixed.filter((f) => !freshKeys.has(f.key));
  const fixedKeys = new Set(fixed.map((f) => f.key));
  for (const f of gone) if (!fixedKeys.has(f.key)) fixed.push(f);
  return { result: fresh, at, cleared: prev.cleared, fixed };
}

/** Clear one row: an open finding is dismissed, a fixed one leaves the list. */
export function clearFinding(mem: JobCheckMemory, key: string): JobCheckMemory {
  if (mem.fixed.some((f) => f.key === key)) {
    return { ...mem, fixed: mem.fixed.filter((f) => f.key !== key) };
  }
  if (mem.cleared.includes(key)) return mem;
  return { ...mem, cleared: [...mem.cleared, key] };
}

/** Put every cleared finding back on the list. */
export function unclearAll(mem: JobCheckMemory): JobCheckMemory {
  return { ...mem, cleared: [] };
}

/** True when `key` is still open in `mem` — what a single re-check reports on. */
export function isOpen(mem: JobCheckMemory, key: string): boolean {
  return openFindings(mem).some((f) => f.key === key);
}

// ---------------------------------------------------------------------------
// LOCAL STORAGE
// ---------------------------------------------------------------------------

const PREFIX = "ascent.presend.v1:";
/** A check older than this describes a month nobody is closing any more. */
const KEEP_DAYS = 45;

const keyOf = (jobId: string, ym: string) => `${PREFIX}${ym}:${jobId}`;

function ls(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): JobCheckMemory | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<JobCheckMemory>;
    if (!m?.result || !Array.isArray(m.result.findings) || typeof m.at !== "string") return null;
    return {
      result: m.result,
      at: m.at,
      cleared: Array.isArray(m.cleared) ? m.cleared : [],
      fixed: Array.isArray(m.fixed) ? m.fixed : [],
    };
  } catch {
    return null;
  }
}

export function readCheck(jobId: string, ym: string): JobCheckMemory | null {
  try {
    return parse(ls()?.getItem(keyOf(jobId, ym)) ?? null);
  } catch {
    return null;
  }
}

export function readChecks(jobIds: string[], ym: string): Record<string, JobCheckMemory> {
  const out: Record<string, JobCheckMemory> = {};
  for (const id of jobIds) {
    const m = readCheck(id, ym);
    if (m) out[id] = m;
  }
  return out;
}

export function writeCheck(jobId: string, ym: string, mem: JobCheckMemory): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(keyOf(jobId, ym), JSON.stringify(mem));
  } catch {
    // Quota full or storage blocked: the list still works, it just won't survive a reload.
  }
  prune(s);
}

/** Drop checks past KEEP_DAYS, so months nobody revisits do not pile up. */
function prune(s: Storage): void {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    const stale: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const m = parse(s.getItem(k));
      if (!m || Date.parse(m.at) < cutoff) stale.push(k);
    }
    for (const k of stale) s.removeItem(k);
  } catch {
    /* best-effort */
  }
}

/** "2:14 pm" today, "Oct 6, 2:14 pm" on another day. */
export function checkedAtLabel(at: string, now = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
