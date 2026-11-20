/**
 * JOB DEPOSITS — the one read both deposit routes answer with: the job's ledger
 * (JobTread draws, read live, plus the deposit entered by hand) and its client
 * payments. Server only (database + grant key). Rules: src/lib/deposits.ts.
 */
import { getPaveConfig } from "@/lib/config";
import { buildDepositLedger, summarizeDeposit, type DepositSummary } from "@/lib/deposits";
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
