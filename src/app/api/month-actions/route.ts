import { NextRequest, NextResponse } from "next/server";

import { listMonthActions } from "@/lib/monthActions";

/**
 * GET ?ym=YYYY-MM → { runs: [{ action, scope, ym, at, by, note }] } — when each
 * month-closing action last ran in that billing month (src/lib/monthActions.ts).
 * Rides the Tracking Sheets gate (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ym = req.nextUrl.searchParams.get("ym") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) {
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
