import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { saveDispositions } from "@/lib/invoiceReview/dispositions";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { investigateReview } from "@/lib/invoiceReview/investigate";
import { resolveInvestigateModel } from "@/lib/invoiceReview/investigateModels";
import { runInvoiceReview } from "@/lib/invoiceReview/run";
import { readLatestRun } from "@/lib/invoiceReview/runs";

/**
 * POST /api/invoice-review/investigate  { ym, model? }
 *
 * Claude works the month's findings with read-only tools and returns a verdict
 * on each — see investigate.ts. This is the pass that does what the skill file
 * has always told a HUMAN to do: search Drive for the amount behind missing
 * backup, check whether a "missing" bill is filed under a different spelling,
 * open a suspected double-bill and see whether one half is a credit.
 *
 * ## It reads the FILED run, and re-runs only if there isn't one
 *
 * Investigating a month means investigating a specific set of findings. Taking
 * them from the last filed run means the verdicts line up with what the office
 * is looking at on screen, instead of with a fresh sweep that may have moved
 * underneath them.
 *
 * ## What it writes
 *
 * One row per verdict in the companion's own `invoice_review_dispositions`.
 * A verdict is NOT a ruling: it changes no number, hides no finding, and moves
 * no severity. Only the office can silence a finding, and only through the
 * ruling path with a reason against their name.
 *
 * ## Cost
 *
 * The most expensive call in the feature — a tool loop over the whole month
 * with thinking on. It is deliberately never automatic: nothing schedules it,
 * and it runs only when somebody presses the button.
 *
 * `model` picks which model runs it, from the allowlist in
 * investigateModels.ts (Sonnet by default, Opus for a messy month). The static
 * prefix — system prompt plus tool schemas — is cached across the loop's
 * iterations, which is where most of the cost used to go. The response carries
 * `usage`, cache counters included, so a caching regression is visible instead
 * of just being a bigger bill.
 *
 * Gated by the `invoice-review` view in middleware, the same as the review
 * itself: whoever can see the month's billing can ask for it to be chased.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  const who = session?.user?.email ?? "";

  let body: { ym?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = parseYm(String(body.ym ?? "").trim());
  if (!parsed) {
    return NextResponse.json({ error: "Pass ym=YYYY-MM (the billing month)." }, { status: 400 });
  }
  const ym = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;

  try {
    // Prefer the filed run, so the verdicts match what is on screen.
    const stored = await readLatestRun(ym);
    let payload = stored?.payload ?? null;
    if (!payload) {
      if (!hasGrant()) {
        return NextResponse.json(
          { error: "This month has not been reviewed yet, and JT_GRANT_KEY is not set." },
          { status: 400 },
        );
      }
      payload = await runInvoiceReview(getPaveConfig(), parsed.year, parsed.month, {
        saveAs: who || "anonymous",
      });
    }

    // The model id comes from the browser, so it is resolved against the
    // allowlist rather than passed through — otherwise anyone with access to
    // the review could point the most expensive call in the app anywhere.
    const model = resolveInvestigateModel(body.model);
    const result = await investigateReview(payload, hasGrant() ? getPaveConfig() : null, {
      model,
    });

    const failed = await saveDispositions(ym, result.model, result.dispositions);
    return NextResponse.json({
      ym,
      ...result,
      // Surfaced rather than swallowed, so "why did the verdicts vanish on
      // reload" is answerable.
      storeError: failed || undefined,
    });
  } catch (e) {
    // Never silent: an empty verdict list and a failed call must not look the
    // same, or the office concludes nothing needed chasing.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
