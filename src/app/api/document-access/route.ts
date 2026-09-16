import { NextRequest, NextResponse } from "next/server";
import {
  getDocumentAccess,
  getJobCustomerContacts,
  getMonthBillAccess,
  grantDocumentAccess,
  type DocAccessRow,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * The "Document Access" list on vendor bills, read and added to without opening
 * each document in JobTread — a whole month at once, or one bill on its own.
 *
 * GET  ?jobId=&ym=YYYY-MM  → the job's customer contacts, each with how many of
 *                            the month's bills they already reach.
 * GET  ?docId=             → the same, for that one bill.
 * POST { membershipId } + either { jobId, ym } or { docId }
 *                          → add that contact to every bill in scope that does
 *                            not already list them.
 *
 * A `docId` carries its own job (read off the document), so the scope and the
 * set of contacts that may be named come from JobTread, not from the caller.
 *
 * Rides the Tracking Sheets gate (src/lib/views.ts), so office+admin only.
 */

/** "2026-09" → [2026, 9]; anything else → null. */
function parseYm(ym: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return [Number(m[1]), month];
}

/**
 * What one request is about: the bills in scope, and the job whose customer
 * contacts may be given them. Both halves come from JobTread.
 */
async function resolveScope(
  cfg: ReturnType<typeof getPaveConfig>,
  input: { docId?: string | null; jobId?: string | null; ym?: string | null },
): Promise<{ jobId: string; bills: DocAccessRow[] } | { error: string }> {
  const docId = (input.docId ?? "").trim();
  if (docId) {
    const { jobId, row } = await getDocumentAccess(cfg, docId);
    if (!jobId) return { error: "That document is not on a job." };
    return { jobId, bills: [row] };
  }
  const jobId = (input.jobId ?? "").trim();
  const period = parseYm(input.ym ?? "");
  if (!jobId || !period) return { error: "Pass docId, or jobId and ym (YYYY-MM)" };
  return { jobId, bills: await getMonthBillAccess(cfg, jobId, period[0], period[1]) };
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  try {
    const cfg = getPaveConfig();
    const scope = await resolveScope(cfg, {
      docId: p.get("docId"),
      jobId: p.get("jobId"),
      ym: p.get("ym"),
    });
    if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: 400 });

    const contacts = await getJobCustomerContacts(cfg, scope.jobId);
    return NextResponse.json({
      billCount: scope.bills.length,
      writesEnabled: writesEnabled(),
      contacts: contacts.map((c) => ({
        ...c,
        granted: scope.bills.filter((b) => b.membershipIds.includes(c.membershipId)).length,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { jobId?: string; ym?: string; docId?: string; membershipId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const membershipId = (body.membershipId ?? "").trim();
  if (!membershipId) return NextResponse.json({ error: "Pass membershipId" }, { status: 400 });

  try {
    const cfg = getPaveConfig();
    const scope = await resolveScope(cfg, body);
    if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: 400 });

    // The contact must belong to THIS job's customer — the membership id arrives
    // from the browser, and without this any customer in the org could be given
    // another client's bills.
    const contacts = await getJobCustomerContacts(cfg, scope.jobId);
    const contact = contacts.find((c) => c.membershipId === membershipId);
    if (!contact) {
      return NextResponse.json(
        { error: "That contact is not on this job's customer." },
        { status: 403 },
      );
    }

    const missing = scope.bills.filter((b) => !b.membershipIds.includes(membershipId));
    const already = scope.bills.length - missing.length;
    if (!writesEnabled()) {
      return NextResponse.json({
        previewed: true,
        added: 0,
        already,
        wouldAdd: missing.length,
        failed: [],
        name: contact.name,
      });
    }

    let added = 0;
    const failed: string[] = [];
    for (const bill of missing) {
      try {
        await grantDocumentAccess(cfg, bill.id, membershipId);
        added++;
      } catch (e) {
        failed.push(`${bill.label}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    return NextResponse.json({ added, already, failed, name: contact.name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
