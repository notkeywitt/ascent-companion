/**
 * JOB DEPOSITS — the one read both deposit routes answer with: the job's ledger
 * (JobTread, read live), its client payments, and the companion's own links.
 * Server only (database + grant key). Rules: src/lib/deposits.ts.
 */
import { getPaveConfig } from "@/lib/config";
import { buildDepositLedger } from "@/lib/deposits";
import { readDepositLinks } from "@/lib/depositLinks";
import { getJobDepositInputs } from "@/lib/jobtread";

export async function readDeposits(jobId: string) {
  const links = await readDepositLinks(jobId);
  const read = await getJobDepositInputs(getPaveConfig(), jobId, links.paymentIds);
  return {
    jobId: read.jobId,
    jobName: read.jobName,
    account: read.accountId ? { id: read.accountId, name: read.accountName ?? "" } : null,
    ledger: buildDepositLedger({ ...read.inputs, links }),
    clientPayments: read.clientPayments,
    note: links.note,
    updatedAt: links.updatedAt,
    updatedBy: links.updatedBy,
  };
}

export type DepositsPayload = Awaited<ReturnType<typeof readDeposits>>;
