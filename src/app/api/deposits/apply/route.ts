import { NextRequest, NextResponse } from "next/server";
import {
  getInvoiceForDraw,
  getJobDepositInputs,
  getLineJournalSnapshot,
  resolveDepositLeaf,
  writeDepositDraw,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { buildDepositLedger, planDepositDraw } from "@/lib/deposits";
import { readDepositLinks } from "@/lib/depositLinks";
import { readDeposits } from "@/lib/depositRead";
import { openJournal } from "@/lib/financialJournal";
import { qboLock } from "@/lib/qboLock";

/**
 * APPLY PART OF A DEPOSIT TO A DRAFT INVOICE — the one JobTread write behind the
 * deposit card (DEPOSITS_PLAN.md, Stage 4).
 *
 * POST { invoiceId, amount } sets the invoice's ONE deposit line to −amount:
 * adds it, changes it, or (amount 0) removes it. Every limit is checked on a
 * ledger read fresh from JobTread here, never on figures the browser sent:
 *   - a DRAFT customer invoice that QuickBooks has not seen (`qboLock`);
 *   - no more than the deposit has left, less other drafts' draws;
 *   - no more than the invoice's own total.
 * The write is verified (price moved by the draw, tax did not move) and undone
 * on a mismatch, then journalled. Answers with the card's fresh payload.
 *
 * Gated by the `recode` view (its `/api/deposits` path covers this route) and by
 * `writesEnabled()`.
 */
export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  if (!writesEnabled()) {
    return NextResponse.json({ error: "JobTread writes are switched off for this app." }, { status: 403 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const invoiceId = String(body?.invoiceId ?? "").trim();
  const amount = Number(body?.amount);
  if (!invoiceId) return NextResponse.json({ error: "Pass invoiceId" }, { status: 400 });

  const cfg = getPaveConfig();
  // Fails CLOSED: if JobTread can't say whether QuickBooks holds it, no write.
  const locked = await qboLock(cfg, { docId: invoiceId });
  if (locked) return locked;

  let inv;
  let plan;
  try {
    inv = await getInvoiceForDraw(cfg, invoiceId);
    const links = await readDepositLinks(inv.jobId);
    const read = await getJobDepositInputs(cfg, inv.jobId, links.paymentIds);
    plan = planDepositDraw(buildDepositLedger({ ...read.inputs, links }), inv, amount);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });
  if (plan.mode === "noop") return NextResponse.json(await readDeposits(inv.jobId));

  const j = await openJournal("/api/deposits/apply");
  const action = plan.mode === "delete" ? "invoice.deposit.remove" : "invoice.deposit.apply";
  // A removed line leaves a record, not a disappearance (CLAUDE.md).
  const snapshot = plan.mode === "delete" && plan.lineId ? await getLineJournalSnapshot(cfg, plan.lineId) : null;
  try {
    const leafId = plan.mode === "create" ? await resolveDepositLeaf(cfg, inv.jobId) : null;
    const res = await writeDepositDraw(cfg, inv, { ...plan, mode: plan.mode }, leafId);
    await j.record([
      {
        action,
        entity: "line",
        entityId: res.lineId ?? plan.lineId ?? "",
        docId: inv.id,
        jobId: inv.jobId,
        field: "price",
        before: -plan.from,
        after: -plan.to,
        beforeSource: "read",
        amount: Math.round((plan.to - plan.from) * 100) / 100,
        meta: { invoiceNumber: inv.number, mode: plan.mode, leafId, totalsBefore: res.before, totalsAfter: res.after, snapshot },
      },
    ]);
    return NextResponse.json(await readDeposits(inv.jobId));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await j.record([
      { action, entity: "line", entityId: plan.lineId ?? "", docId: inv.id, jobId: inv.jobId, outcome: "error", error, amount: plan.to - plan.from },
    ]);
    return NextResponse.json({ error }, { status: 502 });
  }
}
