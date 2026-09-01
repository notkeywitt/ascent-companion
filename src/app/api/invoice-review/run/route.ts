import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { auth, envAllowed } from "@/auth";
import { deriveBillingPeriod } from "@/lib/billing";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { runInvoiceReview } from "@/lib/invoiceReview/run";

/**
 * POST|GET /api/invoice-review/run — review a billing month and FILE the run.
 *
 * WHY THIS ROUTE EXISTS. The review is only useful if somebody runs it, and
 * without a scheduled run the only way was to open the page and wait out a
 * full sweep of JobTread, Drive and Gmail. A recurring call here fixes both —
 * the month stays current, the page opens instantly onto a stored result, and
 * the history fills whether or not anyone visited.
 *
 * ⚠️ NOT ON A VERCEL CRON TODAY. It was, briefly (a third `crons` entry in
 * vercel.json, alongside the digest's two), but Vercel Hobby caps a project at
 * TWO Cron Jobs total — the digest's 8am/5pm pair already uses both — and
 * adding a third appears to make Vercel reject the whole `crons` array for the
 * deployment rather than just the extra one: the digest went silent the same
 * night this route's cron entry shipped, with no code of its own touched. The
 * entry was reverted; this route still works, called manually or from a admin
 * button, but nothing calls it on a timer right now. Recovering the schedule
 * needs either a Pro-tier project (raises the cap) or folding this call inside
 * one of the digest's existing two firings rather than claiming a third slot.
 *
 * ?ym=YYYY-MM picks the billing month; the default is the one currently being
 * accumulated, per `deriveBillingPeriod` (the same 10th-to-10th rule the rest
 * of the system bills by, so on the 5th of August this reviews July).
 *
 * TWO CALLERS, TWO CREDENTIALS — the same shape as /api/digest/run, and for the
 * same reason: the scheduler has no Google session, so this route is listed as
 * PUBLIC in src/middleware.ts and does its own authorization instead. It
 * accepts a scheduler bearer token or an admin session, and nothing else. Being
 * in the PUBLIC list removes the session requirement, not the authorization —
 * don't relax what's below without thinking about who could then trigger an
 * org-wide JobTread sweep.
 *
 * STILL READ-ONLY where it counts. The run reads JobTread, Drive and Gmail and
 * writes exactly one row to the companion's own database. It cannot change an
 * invoice, a bill, a file or a status.
 */
export const dynamic = "force-dynamic";
// A month is a dozen jobs × (several Pave calls + an Apps Script round trip),
// plus the mailbox sweep and one Claude call. Same budget as the review route.
export const maxDuration = 300;

/** Constant-time compare that tolerates different lengths. */
function secretMatches(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorize(
  req: NextRequest,
): Promise<{ ok: true; who: string } | { ok: false; status: number }> {
  // 1. Scheduler credential. Vercel Cron sends this automatically when
  //    CRON_SECRET is set on the project.
  const expected = (process.env.DIGEST_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (bearer) {
    return secretMatches(bearer, expected) ? { ok: true, who: "cron" } : { ok: false, status: 401 };
  }

  // 2. An admin session — the manual "run it now" path.
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (session?.user?.role === "admin" || (email && envAllowed().includes(email))) {
    return { ok: true, who: email || "admin" };
  }

  // 3. Local dev with no auth configured at all, matching the middleware's own
  //    "neither auth configured => open" branch so `npm run dev` works.
  if (!process.env.AUTH_GOOGLE_ID && !process.env.APP_PASSWORD) {
    return { ok: true, who: "local-dev" };
  }
  return { ok: false, status: session?.user ? 403 : 401 };
}

async function handle(req: NextRequest) {
  const authorized = await authorize(req);
  if (!authorized.ok) {
    return NextResponse.json(
      { error: authorized.status === 403 ? "Forbidden" : "Unauthorized" },
      { status: authorized.status },
    );
  }
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  // Default to the billing month currently being accumulated — the one the
  // office is working — rather than the calendar month.
  const asked = req.nextUrl.searchParams.get("ym")?.trim();
  const period = deriveBillingPeriod(new Date(), false);
  const parsed = asked
    ? parseYm(asked)
    : { year: period.billingYear, month: period.billingMonthNum };
  if (!parsed) {
    return NextResponse.json({ error: "Pass ym=YYYY-MM (the billing month)." }, { status: 400 });
  }

  try {
    const payload = await runInvoiceReview(getPaveConfig(), parsed.year, parsed.month, {
      saveAs: authorized.who,
    });
    const live = payload.findings.filter((f) => !f.suppressedBy);
    // A summary, not the review — the scheduler has nobody to read a payload,
    // and the run is on the page by the time anyone looks.
    console.log(
      `[invoice-review] ${payload.evidence.ym} by ${authorized.who}: ` +
        `${live.filter((f) => f.severity === "error").length} to fix, ` +
        `${live.filter((f) => f.severity === "warning").length} to look at, ` +
        `${payload.evidence.warnings.length} evidence warning(s), ${payload.durationMs}ms`,
    );
    return NextResponse.json({
      ok: true,
      ranBy: authorized.who,
      ym: payload.evidence.ym,
      errors: live.filter((f) => f.severity === "error").length,
      warnings: live.filter((f) => f.severity === "warning").length,
      suppressed: payload.findings.length - live.length,
      evidenceWarnings: payload.evidence.warnings,
      durationMs: payload.durationMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[invoice-review] run failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

/** Accepted as well, because some schedulers only issue GETs. Same code path,
 *  same credentials. */
export async function GET(req: NextRequest) {
  return handle(req);
}
