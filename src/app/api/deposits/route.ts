import { NextRequest, NextResponse } from "next/server";
import { getJobDepositInputs, pave } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { buildDepositLedger } from "@/lib/deposits";
import {
  assignDepositPayment,
  readDepositLinks,
  setDepositOpening,
  unassignDepositPayment,
} from "@/lib/depositLinks";
import { openJournal } from "@/lib/financialJournal";

/**
 * JOB DEPOSITS — one job's deposit balance and its client payments.
 *
 * GET  ?jobId=  → { ledger, clientPayments, … }. Read-only against JobTread.
 * POST { jobId, action, … } edits the companion's `deposit_links` row — the
 *      facts JobTread has no field for — and answers with the fresh GET body.
 *      Nothing here writes to JobTread.
 *
 * Gated by the `recode` (Tracking Sheets) view's paths. Rules: src/lib/deposits.ts.
 * Plan: DEPOSITS_PLAN.md.
 */

async function readAll(jobId: string) {
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

const fail = (e: unknown, status = 502) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });
  try {
    return NextResponse.json(await readAll(jobId));
  } catch (e) {
    return fail(e);
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const jobId = String(body?.jobId ?? "").trim();
  const action = String(body?.action ?? "");
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });

  const j = await openJournal("/api/deposits");
  const by = j.actor.email;
  const before = await readDepositLinks(jobId);

  try {
    if (action === "assign-payment" || action === "unassign-payment") {
      const paymentId = String(body?.paymentId ?? "").trim();
      if (!paymentId) return NextResponse.json({ error: "Pass paymentId" }, { status: 400 });
      if (action === "assign-payment") {
        // Only a client payment on THIS job's customer account can be its deposit.
        const r = await pave(getPaveConfig(), {
          payment: { $: { id: paymentId }, id: {}, type: {}, account: { id: {} } },
          job: { $: { id: jobId }, id: {}, location: { account: { id: {} } } },
        });
        const payAcct = r?.payment?.account?.id;
        if (!r?.payment?.id || r.payment.type !== "credit" || !payAcct || payAcct !== r?.job?.location?.account?.id) {
          return NextResponse.json(
            { error: "That payment is not a client payment on this job's customer account." },
            { status: 400 },
          );
        }
        await assignDepositPayment(jobId, paymentId, by);
      } else {
        await unassignDepositPayment(jobId, paymentId, by);
      }
      await j.record([
        {
          action: action === "assign-payment" ? "deposit.payment.assign" : "deposit.payment.unassign",
          entity: "deposit",
          entityId: jobId,
          jobId,
          field: "paymentIds",
          before: before.paymentIds,
          after: paymentId,
          beforeSource: "read",
        },
      ]);
    } else if (action === "set-opening" || action === "clear-opening") {
      let opening: { amount: number; asOf: string } | null = null;
      if (action === "set-opening") {
        const amount = Number(body?.amount);
        const asOf = String(body?.asOf ?? "");
        const today = new Date().toISOString().slice(0, 10);
        if (!Number.isFinite(amount) || amount < 0 || amount > 50_000_000) {
          return NextResponse.json({ error: "Enter the deposit left as a dollar amount." }, { status: 400 });
        }
        if (!DAY.test(asOf) || Number.isNaN(Date.parse(asOf)) || asOf > today) {
          return NextResponse.json({ error: "Enter the date that balance was true on (not in the future)." }, { status: 400 });
        }
        opening = { amount, asOf };
      }
      await setDepositOpening(jobId, opening, String(body?.note ?? before.note), by);
      await j.record([
        {
          action: opening ? "deposit.opening.set" : "deposit.opening.clear",
          entity: "deposit",
          entityId: jobId,
          jobId,
          field: "opening",
          before: before.opening,
          after: opening,
          beforeSource: "read",
          amount: opening?.amount ?? null,
        },
      ]);
    } else {
      return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
    }
    return NextResponse.json(await readAll(jobId));
  } catch (e) {
    await j.record([
      { action: `deposit.${action}`, entity: "deposit", entityId: jobId, jobId, outcome: "error", error: String(e) },
    ]);
    return fail(e);
  }
}
