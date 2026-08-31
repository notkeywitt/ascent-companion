import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { liftRuling, recordRuling } from "@/lib/invoiceReview/rulings";
import { runInvoiceReview } from "@/lib/invoiceReview/run";
import type { FindingKind } from "@/lib/invoiceReview/types";

/**
 * The monthly client-invoice review.
 *
 * GET  ?ym=YYYY-MM[&narrate=0]  → run the review for a billing month.
 * POST { key, kind, jobId, scope, reason }  → record a standing ruling.
 * POST { key, lift: true }                  → lift one.
 *
 * ## Why this is a typed route and not the /api/pave gateway
 *
 * The review is a multi-step server-side composition — a job roster, then five
 * JobTread calls and one Apps Script call per job, then the checks, then a
 * Claude pass. That is exactly the "hot or multi-step path where server-side
 * composition matters" that FRONTEND_ARCHITECTURE.md reserves typed routes for.
 * It also needs the Apps Script bridge for Drive, which the gateway cannot
 * reach at all.
 *
 * ## What it writes
 *
 * GET writes NOTHING — not to JobTread, not to Drive, not to the sheet. It only
 * reads and reports. POST writes exactly one thing: a row in the companion's own
 * `invoice_review_rulings` table saying the office overruled a finding. No path
 * in this feature can change an invoice, a bill, a file, or a number, which is
 * the point: a reviewer that could edit what it reviews is not a reviewer.
 *
 * Gated by the `invoice-review` view (src/lib/views.ts), enforced in middleware
 * — the page and this route share one gate, so a role that can't see the review
 * can't read a month's billing through the route either.
 */
export const dynamic = "force-dynamic";
// A full month can be a dozen jobs × (5 Pave calls + one Apps Script round
// trip), plus the Claude pass. The default 10s budget is nowhere near enough.
export const maxDuration = 300;

const SCOPES = new Set(["finding", "job-kind"]);

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const ym = req.nextUrl.searchParams.get("ym")?.trim() ?? "";
  const parsed = parseYm(ym);
  if (!parsed) {
    return NextResponse.json({ error: "Pass ym=YYYY-MM (the billing month)." }, { status: 400 });
  }
  // ?narrate=0 skips the Claude paragraph — for the skill, which writes its own
  // narrative, and for anyone debugging a check without burning a model call.
  const narrate = req.nextUrl.searchParams.get("narrate") !== "0";

  try {
    const payload = await runInvoiceReview(getPaveConfig(), parsed.year, parsed.month, { narrate });
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const who = session?.user?.email ?? "";

  let body: {
    key?: string;
    kind?: string;
    jobId?: string;
    scope?: string;
    reason?: string;
    lift?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const key = String(body.key ?? "").trim();
  if (!key) return NextResponse.json({ error: "Pass the finding's key." }, { status: 400 });

  try {
    if (body.lift) {
      await liftRuling(key);
      return NextResponse.json({ ok: true, lifted: key });
    }

    const reason = String(body.reason ?? "").trim();
    // A ruling with no reason is worse than no ruling: next year nobody will
    // know why the finding was silenced, and it will never be revisited.
    if (!reason) {
      return NextResponse.json({ error: "Say why this is not a problem." }, { status: 400 });
    }
    const scope = String(body.scope ?? "finding");
    if (!SCOPES.has(scope)) {
      return NextResponse.json({ error: "scope must be 'finding' or 'job-kind'." }, { status: 400 });
    }

    await recordRuling({
      key,
      kind: String(body.kind ?? "") as FindingKind,
      jobId: String(body.jobId ?? ""),
      scope: scope as "finding" | "job-kind",
      reason,
      by: who,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
