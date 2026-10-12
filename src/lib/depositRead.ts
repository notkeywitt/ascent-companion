/**
 * JOB DEPOSITS — the one read both deposit routes answer with: the job's ledger
 * (JobTread draws, read live, plus the deposit entered by hand) and its client
 * payments. Server only (database + grant key). Rules: src/lib/deposits.ts.
 */
import { getPaveConfig } from "@/lib/config";
import { buildDepositLedger } from "@/lib/deposits";
import { readEnteredDeposit } from "@/lib/depositLinks";
import { getJobDepositInputs } from "@/lib/jobtread";

export async function readDeposits(jobId: string) {
  const [stored, read] = await Promise.all([readEnteredDeposit(jobId), getJobDepositInputs(getPaveConfig(), jobId)]);
  return {
    jobId: read.jobId,
    jobName: read.jobName,
    ledger: buildDepositLedger({ lines: read.lines, entered: stored.entered }),
    entered: stored.entered,
    clientPayments: read.clientPayments,
    note: stored.note,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  };
}

export type DepositsPayload = Awaited<ReturnType<typeof readDeposits>>;
