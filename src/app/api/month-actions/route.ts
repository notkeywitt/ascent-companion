import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { listMonthActions, recordMonthAction } from "@/lib/monthActions";
import { MONTH_CLOSE_ACTION, MONTH_CLOSE_SCOPE } from "@/lib/monthChangeSheets";

/**
 * GET ?ym=YYYY-MM → { runs: [{ action, scope, ym, at, by, note }] } — when each
 * month-closing action last ran in that billing month (src/lib/monthActions.ts).
 * Rides the Tracking Sheets gate (src/lib/views.ts).
 *
 * POST { action: "month-close", ym } — stamps that month close ran for the
 * tracking sheets (src/components/MonthChangeSheets.tsx, after every sheet has
 * its records). It is the only stamp a browser may write: every other action
 * is stamped by its own route. Office and admin only. Companion database
 * only; nothing here touches JobTread or a sheet.
 */
export const dynamic = "force-dynamic";

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const ym = req.nextUrl.searchParams.get("ym") ?? "";
  if (!YM.test(ym)) {
    return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });
  }
  try {
    return NextResponse.json({ runs: await listMonthActions(ym) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role ?? "field";
  if (role !== "admin" && role !== "office") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const ym = String(body.ym ?? "");
  if (body.action !== MONTH_CLOSE_ACTION || !YM.test(ym)) {
    return NextResponse.json({ error: 'Pass action "month-close" and ym as "YYYY-MM".' }, { status: 400 });
  }
  await recordMonthAction(MONTH_CLOSE_ACTION, MONTH_CLOSE_SCOPE, ym, session?.user?.email ?? "", String(body.note ?? "").slice(0, 200));
  return NextResponse.json({ ok: true });
}
