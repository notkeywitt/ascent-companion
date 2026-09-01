import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { buildBrief } from "@/lib/invoiceReview/brief";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { liftRuling, recordRuling } from "@/lib/invoiceReview/rulings";
import { runInvoiceReview } from "@/lib/invoiceReview/run";
import { listRuns, readLatestRun } from "@/lib/invoiceReview/runs";
import type { FindingKind, ReviewPayload, RulingScope } from "@/lib/invoiceReview/types";

/**
 * The monthly client-invoice review.
 *
 * GET  ?ym=YYYY-MM[&narrate=0][&email=0][&format=brief][&stored=1][&history=1]
 *        → run the review for a billing month. `format=brief` returns the
 *          paste-into-Claude briefing as markdown instead of JSON, which is how
 *          the review is used when there is no ANTHROPIC_API_KEY.
 *          `stored=1` returns the most recent FILED run for the month instead
 *          of computing a new one — instant, and identical to what that run
 *          showed, because it is that run. It falls through to a live run when
 *          the month has never been reviewed; `stored=only` instead answers
 *          `{ stored: null }`, which is what the page opens with.
 *          `history=1` returns the month's run list (no payloads) instead.
 * POST { key, kind, jobId, scope, reason[, customerName] } → record a ruling.
 * POST { key, lift: true }                                 → lift one.
 *
 * ## Every live run is filed
 *
 * A GET that actually computes a review also records it (see runs.ts). That is
 * what makes "what did this month look like last week" answerable, and it is
 * the history the learning layer is built on. It is best-effort: a companion DB
 * that is unreachable costs the history a row, never the office a review.
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
 * GET writes NOTHING to JobTread, to Drive, or to the sheet. It reads those and
 * reports. The only writes anywhere in this feature are two rows in the
 * companion's OWN database: the run itself (`invoice_review_runs`, history) and
 * a ruling saying the office overruled a finding (`invoice_review_rulings`). No
 * path here can change an invoice, a bill, a file, or a number, which is the
 * point: a reviewer that could edit what it reviews is not a reviewer.
 *
 * Gated by the `invoice-review` view (src/lib/views.ts), enforced in middleware
 * — the page and this route share one gate, so a role that can't see the review
 * can't read a month's billing through the route either.
 */
export const dynamic = "force-dynamic";
// A full month can be a dozen jobs × (5 Pave calls + one Apps Script round
// trip), plus the Claude pass. The default 10s budget is nowhere near enough.
export const maxDuration = 300;

const SCOPES = new Set<RulingScope>(["finding", "job-kind", "customer-kind"]);

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
  // ?email=0 skips the mailbox sweep, which is the slow half (up to two Gmail
  // searches per invoice). The email checks then report nothing at all rather
  // than passing — see `emailChecked` in evidence.ts.
  const email = req.nextUrl.searchParams.get("email") !== "0";

  // Who to file the run under. The route is view-gated, so there is normally a
  // session; "" only happens in a local dev with no auth configured.
  const session = await auth();
  const who = session?.user?.email ?? "";
  const monthYm = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;

  try {
    // ?history=1 — the month's runs, without their payloads. Cheap enough to
    // chart, and the answer to "when was this last checked, and by whom".
    if (req.nextUrl.searchParams.get("history") === "1") {
      return NextResponse.json({ ym: monthYm, runs: await listRuns(monthYm) });
    }

    let payload: ReviewPayload | null = null;

    // ?stored — hand back the last filed run rather than sweeping JobTread,
    // Drive and Gmail again. This is what makes the page open instantly. A row
    // whose JSON won't parse is treated as no row at all.
    //
    //   stored=1     prefer the filed run, but compute one if the month has
    //                never been reviewed — a caller always gets an answer.
    //   stored=only  the filed run or nothing. The page opens with this, so
    //                landing on an unreviewed month shows the "run it" prompt
    //                instead of silently starting a minute-long sweep nobody
    //                asked for.
    const storedMode = req.nextUrl.searchParams.get("stored");
    if (storedMode) {
      const stored = await readLatestRun(monthYm);
      if (stored?.payload) {
        // Stamped so the page can never present a filed run as a fresh one.
        payload = { ...stored.payload, storedAt: stored.ranAt };
      } else if (storedMode === "only") {
        return NextResponse.json({ stored: null });
      }
    }

    if (!payload) {
      payload = await runInvoiceReview(getPaveConfig(), parsed.year, parsed.month, {
        narrate,
        email,
        saveAs: who || "anonymous",
      });
    }
    // ?format=brief hands back the paste-into-Claude briefing instead of JSON —
    // the no-API-key path (see brief.ts).
    if (req.nextUrl.searchParams.get("format") === "brief") {
      return new NextResponse(buildBrief(payload), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
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
    customerName?: string;
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
    const scope = String(body.scope ?? "finding") as RulingScope;
    if (!SCOPES.has(scope)) {
      return NextResponse.json(
        { error: "scope must be 'finding', 'job-kind' or 'customer-kind'." },
        { status: 400 },
      );
    }
    const customerName = String(body.customerName ?? "").trim();
    // A customer-kind ruling with no customer would be stored under an empty
    // wildcard and then silence that kind for EVERY customer. Refuse it.
    if (scope === "customer-kind" && !customerName) {
      return NextResponse.json(
        { error: "A customer-wide ruling needs the customer's name." },
        { status: 400 },
      );
    }

    await recordRuling({
      key,
      kind: String(body.kind ?? "") as FindingKind,
      jobId: String(body.jobId ?? ""),
      customerName,
      scope,
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
