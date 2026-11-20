import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isYm } from "@/lib/monthClose";
import { closedJobs, closeJobMonth, SHEET_JOBS_TAG, unlockJobMonth } from "@/lib/monthCloseServer";

/**
 * The per-job month close on Invoice Status, for after the invoice is sent.
 * Writes the job's tracking sheet and the companion DB. Never writes JobTread.
 *
 * GET  ?ym=YYYY-MM                      → { closed: { [jtJobId]: { at, by } } }
 * POST { op:"close",  jobId, ym }       → file the record block, clear the bill
 *                                         list, Labor A1 to next month, lock
 * POST { op:"unlock", jobId, ym }       → lift the lock; the sheet sync resumes
 *
 * Rides the invoicing-summary view (src/lib/views.ts) by its path prefix.
 * Steps: closeJobMonth in src/lib/monthCloseServer.ts.
 */
export const dynamic = "force-dynamic";
// Finalize, rollover and, when next month's Labor Report is missing, filing it.
export const maxDuration = 300;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET(req: NextRequest) {
  const ym = req.nextUrl.searchParams.get("ym") ?? "";
  if (!isYm(ym)) return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });
  try {
    return NextResponse.json({ closed: await closedJobs(ym) });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const op = String(body.op || "");
  const jobId = String(body.jobId || "");
  const ym = String(body.ym || "");
  if (!jobId) return NextResponse.json({ error: "Pass a jobId." }, { status: 400 });
  if (!isYm(ym)) return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });
  const session = await auth();
  const by = session?.user?.email ?? "";
  try {
    if (op === "close") {
      const r = await closeJobMonth(jobId, ym, by);
      revalidateTag(SHEET_JOBS_TAG);
      return NextResponse.json({ ok: true, ...r });
    }
    if (op === "unlock") {
      await unlockJobMonth(jobId, ym);
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
  return NextResponse.json({ error: `Unknown op "${op}". Expected close or unlock.` }, { status: 400 });
}
