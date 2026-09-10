import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { parseBillingYm } from "@/lib/billing";
import { mirrorBillingMonth, readBillingMonth, writeBillingMonth } from "@/lib/billingMonth";
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
 *
 * The write lands in TWO places: this app's database, and the Apps Script
 * project's Script Property (bills captured from Gmail are dated there, and it
 * cannot read this database). The push goes FIRST, and a failed push returns
 * 502 with NOTHING changed on either side. That ordering is the whole point:
 * the two must never hold different months, because they would then date the
 * same bill into different customer invoices.
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

  // Validated up front, so an unusable month is rejected before either side is
  // touched — writeBillingMonth checks it again on its own way in.
  const ym = String(body.ym ?? "").trim();
  if (ym !== "" && !parseBillingYm(ym)) {
    return NextResponse.json({ error: 'Pass ym=YYYY-MM, or "" for automatic.' }, { status: 400 });
  }

  const before = await readBillingMonth();

  const mirror = await mirrorBillingMonth(ym);
  if (!mirror.ok && !mirror.skipped) {
    return NextResponse.json(
      {
        error:
          `Couldn't set the month in the Apps Script project, so nothing changed: ${mirror.error} ` +
          `Try again — bills captured from Gmail are dated there.`,
      },
      { status: 502 },
    );
  }

  const state = await writeBillingMonth(ym, session?.user?.email ?? "");
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

  // `mirrored:false` only ever means the bridge isn't configured (local dev) —
  // a real push failure returned 502 above and never got here.
  return NextResponse.json({ ...state, mirrored: mirror.ok });
}
