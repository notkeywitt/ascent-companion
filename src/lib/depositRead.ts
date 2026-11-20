/**
 * JOB DEPOSITS — the one read both deposit routes answer with: the job's ledger
 * (JobTread draws, read live, plus the deposit entered by hand) and its client
 * payments. Server only (database + grant key). Rules: src/lib/deposits.ts.
 */
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig } from "@/lib/config";
import {
  buildDepositLedger,
  depositSheetPayload,
  summarizeDeposit,
  type DepositLedger,
  type DepositSummary,
} from "@/lib/deposits";
import { readAllEnteredDeposits, readEnteredDeposit } from "@/lib/depositLinks";
import { getAllJobDepositLines, getJobDepositInputs } from "@/lib/jobtread";

export async function readDeposits(jobId: string) {
  const [stored, read] = await Promise.all([readEnteredDeposit(jobId), getJobDepositInputs(getPaveConfig(), jobId)]);
  return {
    jobId: read.jobId,
    jobName: read.jobName,
    ledger: buildDepositLedger({ lines: read.lines, entered: stored.entered }),
    entered: stored.entered,
    clientPayments: read.clientPayments,
    invoicedTotal: read.invoicedTotal,
    note: stored.note,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  };
}

export type DepositsPayload = Awaited<ReturnType<typeof readDeposits>>;

/** Every job with a deposit: deposit, applied to date, left. Biggest balance first. */
export async function readAllDeposits(): Promise<DepositSummary[]> {
  const entered = await readAllEnteredDeposits();
  const jobs = await getAllJobDepositLines(getPaveConfig(), [...entered.keys()]);
  return jobs
    .map((j) => ({ j, ledger: buildDepositLedger({ lines: j.lines, entered: entered.get(j.jobId) ?? null }) }))
    .filter(({ ledger }) => ledger.hasDeposit)
    .map(({ j, ledger }) => summarizeDeposit(j.jobId, j.jobName, ledger))
    .sort((a, b) => (b.left ?? -Infinity) - (a.left ?? -Infinity) || a.jobName.localeCompare(b.jobName));
}

export type DepositSheetResult = { ok: true; skipped?: boolean; [k: string]: unknown } | { ok: false; error: string };

/**
 * Write the job's ledger to its tracking sheet's "Deposits" tab (appscript
 * `writeTrackingDeposits`, deposits stage 3). Never throws: a failure comes back
 * as `{ ok:false, error }` and is logged, so it never fails a draw or a sync.
 * A job with no deposit makes no call. `dryRun` returns what it would write.
 * Pass `ledger` when the caller has just read it.
 */
export async function writeDepositSheet(opts: {
  jtJobId: string;
  /** The tracking sheet's project id, when the caller holds it (a sheet can carry two jobs). */
  projectId?: string;
  ym: string;
  ledger?: DepositLedger;
  dryRun?: boolean;
}): Promise<DepositSheetResult> {
  try {
    const ledger = opts.ledger ?? (await readDeposits(opts.jtJobId)).ledger;
    if (!ledger.hasDeposit) return { ok: true, skipped: true };
    const res = await callAppsScript<Record<string, unknown>>(
      {
        action: "writeTrackingDeposits",
        ...(opts.projectId ? { projectId: opts.projectId } : { jtJobId: opts.jtJobId }),
        ...depositSheetPayload(ledger, opts.ym),
        dryRun: opts.dryRun === true,
      },
      // A sheet write: one attempt (appsScript.ts, "Retry safety").
      { retry: false, timeoutMs: 30_000 },
    );
    if (res.error) throw new Error(res.error);
    if (res.data?.ok !== true) throw new Error(String(res.data?.error || "writeTrackingDeposits failed."));
    return res.data as DepositSheetResult;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[deposits] tracking sheet Deposits tab:", error);
    return { ok: false, error };
  }
}
