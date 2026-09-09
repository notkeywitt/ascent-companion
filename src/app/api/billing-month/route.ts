import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { readBillingMonth, writeBillingMonth } from "@/lib/billingMonth";
import { openJournal } from "@/lib/financialJournal";

/**
 * The billing month every non-Sunset bill files into — read by anyone signed
 * in, set by office and admin.
 *
 * Companion-only; nothing here touches JobTread. Ungated in src/lib/views.ts on
 * purpose: the READ is a month, which every role that sees the masthead needs,
 * and the WRITE checks the role here rather than in middleware.
 *
 * Setting it decides where money lands, so the change goes in the financial
 * journal alongside the bill writes it will steer.
 */

// GET /api/billing-month — the month in force, and whether it was set by hand.
export async function GET() {
  return NextResponse.json(await readBillingMonth());
}

// POST /api/billing-month — set it. Body: { ym: "2026-09" }, or "" for automatic.
export async function POST(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role ?? "field";
  if (role !== "admin" && role !== "office") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const before = await readBillingMonth();
  const state = await writeBillingMonth(body.ym, session?.user?.email ?? "");
  if (!state) {
    return NextResponse.json({ error: 'Pass ym=YYYY-MM, or "" for automatic.' }, { status: 400 });
  }

  const journal = await openJournal("/api/billing-month");
  await journal.record([
    {
      action: "billing-month.set",
      entity: "billing-month",
      entityId: state.ym,
      field: "ym",
      before: before.override || `auto:${before.ym}`,
      after: state.override || `auto:${state.ym}`,
      beforeSource: "read",
    },
  ]);

  return NextResponse.json(state);
}
