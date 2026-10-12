import { NextRequest, NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { readDeposits as readAll } from "@/lib/depositRead";
import { readEnteredDeposit, setEnteredDeposit } from "@/lib/depositLinks";
import { openJournal } from "@/lib/financialJournal";

/**
 * JOB DEPOSITS — one job's deposit balance and its client payments.
 *
 * GET  ?jobId=  → { ledger, entered, clientPayments, … }. Read-only against JobTread.
 * POST { jobId, action: "set-deposit", amount, previouslyApplied, note }
 *      or { jobId, action: "clear-deposit" } edits the deposit entered by hand
 *      (the companion's `deposit_links` row) and answers with the fresh GET
 *      body. Nothing here writes to JobTread.
 *
 * Gated by the `recode` (Tracking Sheets) view's paths. Rules: src/lib/deposits.ts.
 */

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

const MAX = 50_000_000;
const dollars = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 && n <= MAX ? n : null;
};

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
  if (action !== "set-deposit" && action !== "clear-deposit") {
    return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
  }

  let entered = null;
  if (action === "set-deposit") {
    const amount = dollars(body?.amount);
    const previouslyApplied = dollars(body?.previouslyApplied);
    if (amount == null || amount === 0) {
      return NextResponse.json({ error: "Enter the deposit as a dollar amount." }, { status: 400 });
    }
    if (previouslyApplied == null) {
      return NextResponse.json({ error: "Enter what was previously applied as a dollar amount (0 if none)." }, { status: 400 });
    }
    entered = { amount, previouslyApplied };
  }

  const j = await openJournal("/api/deposits");
  const before = await readEnteredDeposit(jobId);
  try {
    await setEnteredDeposit(jobId, entered, String(body?.note ?? before.note), j.actor.email);
    await j.record([
      {
        action: entered ? "deposit.entered.set" : "deposit.entered.clear",
        entity: "deposit",
        entityId: jobId,
        jobId,
        field: "entered",
        before: before.entered,
        after: entered,
        beforeSource: "read",
        amount: entered?.amount ?? null,
      },
    ]);
    return NextResponse.json(await readAll(jobId));
  } catch (e) {
    await j.record([
      { action: `deposit.${action}`, entity: "deposit", entityId: jobId, jobId, outcome: "error", error: String(e) },
    ]);
    return fail(e);
  }
}
