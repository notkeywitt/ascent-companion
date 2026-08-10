import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";
import { writesEnabled } from "@/lib/config";

/**
 * Proxy the LSWDD statement review queue to the Apps Script doPost router.
 *
 * LSWDD (the island dump) bills Ascent monthly on ONE statement carrying dump
 * charges for MANY jobs, with informal names ("Miller", "Shop") that don't
 * always match a job cleanly. The Apps Script sweep parses the statement email
 * and STAGES each charge; nothing reaches JobTread until this route's POST.
 * Submitting groups the reviewed lines by job and creates one draft vendorBill
 * per job, so job costing lands where it belongs.
 *
 * Env (shared with /api/email, /api/needs-project, /api/jt-sync):
 *   APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
 *
 * The submit pushes to JobTread inline (one bill per job), so allow a long
 * timeout — a six-job statement is six pushes.
 */
export const maxDuration = 300;

// GET /api/lswdd[?includePushed=1]
//   → { ok, statements: [{ statementDate, total, unresolved, lines[] }],
//       projects: [{ id, label, jtJobId }], defaultCsi }
export async function GET(req: NextRequest) {
  const includePushed = req.nextUrl.searchParams.get("includePushed") === "1";
  return callAppsScriptResponse({ action: "lswddList", includePushed });
}

// POST /api/lswdd
//   { lines: [{ ref, projectId, csi, amount?, learnAlias? }] }
//        → create one draft bill per job  → { ok, bills[], skipped[] }
//   { ref, dismiss: true }   → exclude one charge from JobTread
//   { statementDate }        → exclude every unpushed charge on that statement
//   { rawName, projectId }   → teach the resolver a name for next month
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // Clear a whole month off the queue — the first sweep can pull in back
  // statements whose charges were billed and paid long ago.
  if (body.statementDate !== undefined) {
    const statementDate = String(body.statementDate ?? "").trim();
    if (!statementDate) {
      return NextResponse.json({ error: "statementDate is required." }, { status: 400 });
    }
    return callAppsScriptResponse({ action: "lswddDismissStatement", statementDate });
  }

  if (body.dismiss !== undefined) {
    const ref = String(body.ref ?? "").trim();
    if (!ref) return NextResponse.json({ error: "ref is required." }, { status: 400 });
    return callAppsScriptResponse({ action: "lswddDismiss", ref, dismiss: body.dismiss === true });
  }

  if (body.rawName !== undefined) {
    const rawName = String(body.rawName ?? "").trim();
    const projectId = String(body.projectId ?? "").trim();
    if (!rawName || !projectId) {
      return NextResponse.json({ error: "rawName and projectId are required." }, { status: 400 });
    }
    return callAppsScriptResponse({ action: "lswddAlias", rawName, projectId });
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    return NextResponse.json({ error: "lines is required." }, { status: 400 });
  }

  // Same global kill switch every other JT write path respects. With writes off
  // the Apps Script side still validates and groups the lines and reports the
  // bills it WOULD create — so the page can be exercised end to end safely.
  const dryRun = !writesEnabled();
  return callAppsScriptResponse({ action: "lswddSubmit", lines, dryRun });
}
