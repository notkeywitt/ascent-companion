// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pageAll, type PaveConfig } from "./core";
import { lswddDefaultDue, lswddPayState, lswddStatementOf, type LswddPayState } from "@/lib/lswddPay";

/** One job's bill from an LSWDD statement, as the /lswdd page lists it. */
export interface LswddBill {
  id: string;
  number: number | null;
  jobId: string;
  jobName: string;
  cost: number;
  amountPaid: number;
  /** JobTread's own status: draft | pending | approved | denied. */
  status: string;
  /** "Bill" or "Expense" — decides what Approve sets. */
  name: string;
  qboDocumentType: string;
  dueDate: string;
  payState: LswddPayState;
}

/** The newest LSWDD statement's bills, and when the statement is due. */
export interface LswddStatementBills {
  /** "YYYY-MM-DD", or "" when no statement has reached JobTread yet. */
  statementDate: string;
  dueDate: string;
  bills: LswddBill[];
}

/**
 * The bills from the NEWEST LSWDD statement that reached JobTread.
 *
 * The appscript submit names each job's bill "LSWDD-<statement date>-<project>"
 * (`_lswddSubmitStatement`), so sorting by externalId puts the newest statement
 * first. One page of 50 is many months of statements — a statement is one bill
 * per job, usually three to seven. Voided bills are left out.
 *
 * Probed live 2026-11-09: `organization.documents` takes the `externalId like`
 * filter and the externalId sort.
 */
export async function getLswddStatementBills(cfg: PaveConfig): Promise<LswddStatementBills> {
  const rows = await pageAll<any>(cfg, {
    label: "organization.documents (LSWDD statement bills)",
    size: 50,
    stopAfterPages: 1,
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        documents: {
          $: {
            where: { and: [["type", "vendorBill"], ["externalId", "like", "LSWDD-%"]] },
            sortBy: [{ field: "externalId", order: "desc" }],
            ...args,
          },
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            externalId: {},
            status: {},
            name: {},
            qboDocumentType: {},
            dueDate: {},
            cost: {},
            amountPaid: {},
            job: { id: {}, name: {} },
          },
        },
      },
    }),
    pick: (r) => r?.organization?.documents,
  });

  let statementDate = "";
  for (const r of rows) {
    const s = lswddStatementOf(r?.externalId);
    if (s > statementDate) statementDate = s;
  }
  if (!statementDate) return { statementDate: "", dueDate: "", bills: [] };

  const bills: LswddBill[] = rows
    .filter((r) => lswddStatementOf(r?.externalId) === statementDate && r?.status !== "denied")
    .map((r) => {
      const b = {
        id: String(r.id),
        number: typeof r.number === "number" ? r.number : null,
        jobId: String(r.job?.id ?? ""),
        jobName: String(r.job?.name ?? "—"),
        cost: Number(r.cost) || 0,
        amountPaid: Number(r.amountPaid) || 0,
        status: String(r.status ?? ""),
        name: String(r.name ?? ""),
        qboDocumentType: String(r.qboDocumentType ?? ""),
        dueDate: String(r.dueDate ?? "").slice(0, 10),
      };
      return { ...b, payState: lswddPayState(b) };
    })
    .sort((a, b) => a.jobName.localeCompare(b.jobName));

  // Every bill on a statement carries the date LSWDD printed. Take the earliest
  // in case one was edited; fall back to the 10th.
  const dues = bills.map((b) => b.dueDate).filter(Boolean).sort();
  return { statementDate, dueDate: dues[0] ?? lswddDefaultDue(statementDate), bills };
}
