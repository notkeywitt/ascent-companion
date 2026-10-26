import { NextRequest, NextResponse } from "next/server";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { getInvoicesForPayment, orgLocalToJtIso, recordInvoicePayments } from "@/lib/jobtread";
import { paymentDescription, paymentExternalId, planDepositPayments, type DepositLine } from "@/lib/depositTracker";
import { openJournal } from "@/lib/financialJournal";

/**
 * POST { key, date, reference, lines: [{ invoiceId, amount }] } — record the
 * deposit's checks as payments on the selected client invoices. One JobTread
 * payment per customer account, applied to each of its invoices
 * (`recordInvoicePayments`). The server re-reads every invoice first and
 * refuses the whole set if any one cannot take its amount.
 *
 * `key` is minted once per deposit on the phone. Pressed twice, or retried
 * after a half-finished run, the same key finds the payments already made.
 *
 * Gated by the "deposit-tracker" view (src/lib/views.ts), admin by default.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  if (!writesEnabled()) {
    return NextResponse.json({ error: "JobTread writes are off in this app." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    key?: unknown;
    date?: unknown;
    reference?: unknown;
    lines?: unknown;
  };
  const key = String(body.key ?? "").trim();
  const date = String(body.date ?? "").trim();
  const reference = String(body.reference ?? "").slice(0, 200);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return NextResponse.json({ error: "Missing deposit key." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must look like 2026-10-26." }, { status: 400 });
  }
  const lines: DepositLine[] = Array.isArray(body.lines)
    ? body.lines.map((l: any) => ({ invoiceId: String(l?.invoiceId ?? ""), amount: Number(l?.amount) }))
    : [];
  if (lines.length > 50) return NextResponse.json({ error: "Select at most 50 invoices." }, { status: 400 });

  const cfg = getPaveConfig();
  let plan: ReturnType<typeof planDepositPayments>;
  try {
    plan = planDepositPayments(lines, await getInvoicesForPayment(cfg, lines.map((l) => l.invoiceId)));
  } catch (e) {
    return NextResponse.json(
      { error: `Reading the invoices: ${e instanceof Error ? e.message : "Unknown error"}` },
      { status: 502 },
    );
  }
  if (plan.errors.length) return NextResponse.json({ error: plan.errors.join(" "), errors: plan.errors }, { status: 400 });

  const journal = await openJournal("/api/deposit-tracker/record");
  try {
    const payments = await recordInvoicePayments(cfg, {
      paidAt: orgLocalToJtIso(`${date}T00:00:00`),
      description: paymentDescription(date, reference),
      groups: plan.groups.map((g) => ({ ...g, externalId: paymentExternalId(key, g.accountId) })),
    });
    await journal.record(
      payments.flatMap((p) =>
        p.applied
          .filter((a) => !a.reused)
          .map((a) => ({
            action: "invoice.payment.create",
            entity: "invoice",
            entityId: a.invoiceId,
            docId: a.invoiceId,
            field: "payment",
            before: null,
            beforeSource: "none" as const,
            after: a.amount,
            amount: a.amount,
            meta: { paymentId: p.paymentId, customer: p.customerName, number: a.number, key, date },
          })),
      ),
    );
    return NextResponse.json({ payments });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[deposit-tracker/record]", e);
    await journal.record([
      {
        action: "invoice.payment.create",
        entity: "invoice",
        outcome: "error",
        error: message,
        meta: { key, date, lines },
      },
    ]);
    return NextResponse.json(
      {
        error:
          `Recording the payments: ${message}. Some may be recorded already. ` +
          "Press Record again to finish — it skips what is done.",
      },
      { status: 502 },
    );
  }
}
