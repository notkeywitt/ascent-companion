import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { hasGrant } from "@/lib/config";
import { LaborReportError, fileLaborReport } from "@/lib/laborReport";

/**
 * POST { ym: "YYYY-MM" } → create or update "<Month> '<YY> Labor" in the Drive
 * Labor folder. The work is `fileLaborReport` (src/lib/laborReport.ts), which
 * the office labor routes also run on their own after a write; this route is
 * the "Run now" link beside the "updated N minutes ago" line.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  // Attribution comes from the session, never the body — same rule as /api/code.
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { ym?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const m = /^(\d{4})-(\d{2})$/.exec((body.ym ?? "").trim());
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });
  }

  try {
    const r = await fileLaborReport(Number(m[1]), month, session.user.email ?? "");
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const status = e instanceof LaborReportError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
