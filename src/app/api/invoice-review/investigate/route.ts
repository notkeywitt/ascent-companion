import { NextRequest, NextResponse, after } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { readDispositions, saveDispositions } from "@/lib/invoiceReview/dispositions";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { investigateReview } from "@/lib/invoiceReview/investigate";
import { resolveInvestigateModel } from "@/lib/invoiceReview/investigateModels";
import {
  beginInvestigation,
  failInvestigation,
  finishInvestigation,
  readInvestigation,
} from "@/lib/invoiceReview/investigations";
import { runInvoiceReview } from "@/lib/invoiceReview/run";
import { readLatestRun } from "@/lib/invoiceReview/runs";

/**
 * POST /api/invoice-review/investigate  { ym, model? }   — start a pass
 * GET  /api/invoice-review/investigate?ym=YYYY-MM        — how it is going
 *
 * Claude works the month's findings with read-only tools and returns a verdict
 * on each — see investigate.ts. This is the pass that does what the skill file
 * has always told a HUMAN to do: search Drive for the amount behind missing
 * backup, check whether a "missing" bill is filed under a different spelling,
 * open a suspected double-bill and see whether one half is a credit.
 *
 * ## THE RUN IS DETACHED
 *
 * POST answers `{ started: true }` at once and does the work in `after()`,
 * which keeps the function alive for its own maxDuration no matter what the
 * client does next. It used to be awaited inside the browser's request, and a
 * minutes-long loop cannot be held open by a phone: locking the screen or
 * switching apps killed the fetch, the office saw Safari's "Load failed", and
 * the run died with the connection leaving no record that it had ever been
 * asked for. Progress is now written to `invoice_review_investigations` (see
 * lib/invoiceReview/investigations.ts) and the page POLLS the GET below — so
 * the answer is collectable from any device, and a failure is a stated reason
 * instead of a browser error string.
 *
 * One pass per month at a time: a fresh 'running' claim makes POST answer 409
 * rather than spending the app's most expensive call twice to write the same
 * verdicts.
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
 * One row per verdict in the companion's own `invoice_review_dispositions`,
 * plus the run's status line. A verdict is NOT a ruling: it changes no number,
 * hides no finding, and moves no severity. Only the office can silence a
 * finding, and only through the ruling path with a reason against their name.
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
 * iterations, which is where most of the cost used to go. The stored state
 * carries `usage`, cache counters included, so a caching regression is visible
 * instead of just being a bigger bill.
 *
 * Gated by the `invoice-review` view in middleware, the same as the review
 * itself: whoever can see the month's billing can ask for it to be chased.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The month's verdicts in the shape the page stamps onto its findings. */
async function dispositionList(ym: string) {
  const byKey = await readDispositions(ym);
  return [...byKey.entries()].map(([key, d]) => ({
    key,
    verdict: d.verdict,
    why: d.why,
    suggestedAction: d.suggestedAction,
    model: d.model,
    at: d.at,
  }));
}

/**
 * GET — the state of this month's pass, with whatever verdicts are on file.
 *
 * The page polls this while a run is going and reads it once on open, so a pass
 * started on the office desktop is picked up by the phone that walks in later.
 */
export async function GET(req: NextRequest) {
  const parsed = parseYm((req.nextUrl.searchParams.get("ym") ?? "").trim());
  if (!parsed) {
    return NextResponse.json({ error: "Pass ym=YYYY-MM (the billing month)." }, { status: 400 });
  }
  const ym = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;

  const [investigation, dispositions] = await Promise.all([
    readInvestigation(ym),
    dispositionList(ym),
  ]);
  return NextResponse.json({ ym, investigation, dispositions });
}

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

  // The model id comes from the browser, so it is resolved against the
  // allowlist rather than passed through — otherwise anyone with access to the
  // review could point the most expensive call in the app anywhere.
  const model = resolveInvestigateModel(body.model);

  // Claim the month BEFORE answering. If the claim can't be written there is
  // nowhere for the result to land, so refuse rather than start a pass whose
  // answer nobody could collect.
  let claim: Awaited<ReturnType<typeof beginInvestigation>>;
  try {
    claim = await beginInvestigation(ym, model, who || "anonymous");
  } catch (e) {
    return NextResponse.json(
      {
        error: `The companion database is unreachable, so the investigation could not be started: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      },
      { status: 502 },
    );
  }
  if (!claim.ok) {
    return NextResponse.json(
      {
        error: `An investigation of this month is already running${
          claim.startedBy ? ` (started by ${claim.startedBy})` : ""
        }. Wait for it to finish.`,
        running: true,
        startedAt: claim.startedAt,
      },
      { status: 409 },
    );
  }

  // Detached: everything below outlives this response.
  after(async () => {
    try {
      // Prefer the filed run, so the verdicts match what is on screen.
      const stored = await readLatestRun(ym);
      let payload = stored?.payload ?? null;
      if (!payload) {
        if (!hasGrant()) {
          throw new Error("This month has not been reviewed yet, and JT_GRANT_KEY is not set.");
        }
        payload = await runInvoiceReview(getPaveConfig(), parsed.year, parsed.month, {
          saveAs: who || "anonymous",
        });
      }

      const result = await investigateReview(payload, hasGrant() ? getPaveConfig() : null, {
        model,
      });

      // Verdicts first, status second: the status line says "done" only once
      // the thing it describes is actually on file.
      const failed = await saveDispositions(ym, result.model, result.dispositions);
      if (failed) throw new Error(`The verdicts could not be filed: ${failed}`);

      await finishInvestigation(ym, {
        model: result.model,
        note: result.note,
        findingsConsidered: result.findingsConsidered,
        dispositionCount: result.dispositions.length,
        truncated: result.truncated,
        usage: result.usage,
      });
    } catch (e) {
      // Never silent, in two places: the row the page is polling, and the
      // function log — an empty verdict list and a failed run must not look the
      // same, or the office concludes nothing needed chasing.
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error(`[invoice-review] investigation of ${ym} failed:`, message);
      await failInvestigation(ym, message);
    }
  });

  return NextResponse.json({ ym, model, started: true });
}
