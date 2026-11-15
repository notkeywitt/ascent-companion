import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { list, report, snooze } from "@/lib/findings";
import { companyToday } from "@/lib/homeFacts";
import { getLswddStatementBills } from "@/lib/jobtread";
import { addDays, lswddDayLabel, lswddPayReminder } from "@/lib/lswddPay";

export const dynamic = "force-dynamic";

/**
 * The "Pay LSWDD by <day>" reminder (components/LswddPayReminder), for the
 * signed-in reader. Gated by the `lswdd` view's `/api/lswdd` prefix.
 *
 * GET  → { reminder: { lastPayDay, overdue, unpaid, total, today } | null }.
 *        Reports the reminder into the findings store, scoped to the reader,
 *        and returns null while the reader has it snoozed or dismissed.
 * POST → snoozes the reader's reminder until the next company midnight
 *        ("Later"). Writes the companion database only.
 */
const SOURCE = "lswdd-pay";

async function readerEmail(): Promise<string> {
  return ((await auth())?.user?.email ?? "").toLowerCase();
}

export async function GET() {
  const email = await readerEmail();
  if (!email || !hasGrant()) return NextResponse.json({ reminder: null });
  try {
    const s = await getLswddStatementBills(getPaveConfig());
    const today = companyToday();
    const open = s.bills.filter((b) => b.payState !== "paid");
    const r = lswddPayReminder({ today, dueDate: s.dueDate, unpaid: open.length });
    const total = open.reduce((n, b) => n + b.cost - b.amountPaid, 0);
    await report(
      SOURCE,
      r
        ? [
            {
              key: s.statementDate || s.dueDate,
              kind: "lswdd-pay",
              severity: r.overdue ? "error" : "warning",
              title: r.overdue
                ? `The LSWDD statement is past due: ${open.length} bill${open.length === 1 ? "" : "s"} unpaid`
                : `Pay LSWDD by ${lswddDayLabel(r.lastPayDay)}:${open.length} bill${open.length === 1 ? "" : "s"} unpaid`,
              link: "/lswdd",
            },
          ]
        : [],
      email,
    );
    // A snoozed or dismissed row is left out of `list`: the pop-up stays shut.
    const shown = r && (await list({ source: SOURCE, scope: email, reader: email })).length > 0;
    return NextResponse.json({ reminder: shown ? { ...r, unpaid: open.length, total, today } : null });
  } catch {
    // A failed read reports nothing and shows nothing: never a false alarm.
    return NextResponse.json({ reminder: null });
  }
}

/** The next midnight in the company timezone, as an ISO time. */
function nextCompanyMidnight(now = new Date()): string {
  const tomorrow = addDays(companyToday(now), 1);
  // Pacific midnight is 07:00 UTC in summer, 08:00 in winter.
  let t = Date.parse(`${tomorrow}T07:00:00Z`);
  if (companyToday(new Date(t)) !== tomorrow) t += 3_600_000;
  return new Date(t).toISOString();
}

export async function POST() {
  const email = await readerEmail();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const until = nextCompanyMidnight();
  for (const row of await list({ source: SOURCE, scope: email, reader: email })) await snooze(row.id, until);
  return NextResponse.json({ ok: true });
}
