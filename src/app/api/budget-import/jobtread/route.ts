import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import {
  applyBudgetImport,
  missingFromCatalog,
  planBudgetImport,
  planHash,
  readCatalog,
  readJobBudget,
  resolveChoices,
  type SheetItem,
} from "@/lib/budgetImport";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";
import { clearJobCostCaches } from "@/lib/jobtread";

// Budget Import's "Import into JT" — writes a tracking sheet's estimate straight
// into the job's live budget (src/lib/budgetImport.ts has the matching rules).
//
//   POST { op:"plan",  projectId, markup }                  → { plan, hash, jobId, problems, writesEnabled }
//   POST { op:"apply", projectId, markup, hash, choices }   → { wrote, updated, created, groupsCreated, failed? }
//
// Both ops rebuild the plan server-side from a fresh read of the sheet and the
// budget. `apply` never trusts items sent from the browser: it takes only the
// office's picks for the ambiguous rows, and refuses if the sheet, the budget or
// the markup changed since the preview (the hash).
//
// `apply` is a live JobTread write behind the master writesEnabled() gate.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROUTE = "/api/budget-import/jobtread";

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    op?: unknown;
    projectId?: unknown;
    markup?: unknown;
    hash?: unknown;
    choices?: unknown;
  };
  const op = String(body.op || "");
  if (op !== "plan" && op !== "apply") {
    return NextResponse.json({ error: 'op must be "plan" or "apply".' }, { status: 400 });
  }
  const projectId = String(body.projectId || "").trim();
  if (!projectId) return NextResponse.json({ error: "A project is required." }, { status: 400 });
  const markup = Number(body.markup);
  if (body.markup === "" || body.markup == null || !Number.isFinite(markup) || markup < 0 || markup >= 1000) {
    return NextResponse.json({ error: "Markup must be a percent from 0 to 999." }, { status: 400 });
  }

  const sheet = await callAppsScript<{
    ok?: boolean;
    error?: string;
    jtJobId?: string;
    items?: SheetItem[];
    problems?: string[];
  }>({ action: "getBudgetImportCsv", projectId, markup }, { timeoutMs: 55_000 });
  if (sheet.error) return NextResponse.json({ error: sheet.error }, { status: sheet.status });
  const s = sheet.data!;
  if (s.ok !== true) return NextResponse.json({ error: String(s.error || "Apps Script rejected the request.") }, { status: 502 });
  const jobId = String(s.jtJobId || "");
  if (!jobId) {
    return NextResponse.json({ error: "This project's Projects row has no JobTread Job ID." }, { status: 400 });
  }
  const items = s.items ?? [];

  const cfg = getPaveConfig();
  const [budget, cat] = await Promise.all([readJobBudget(cfg, jobId), readCatalog(cfg)]);
  const plan = planBudgetImport(items, budget.leaves, markup, cat.timeTrackable);
  const hash = planHash(items, budget.leaves, markup);

  if (op === "plan") {
    return NextResponse.json({
      ok: true,
      jobId,
      plan,
      hash,
      problems: s.problems ?? [],
      missing: missingFromCatalog(plan.rows, cat),
      writesEnabled: writesEnabled(),
    });
  }

  if (body.hash !== hash) {
    return NextResponse.json(
      { error: "The sheet, the budget or the markup changed since the preview. Build the preview again." },
      { status: 409 },
    );
  }
  let rows;
  try {
    rows = resolveChoices(plan, (body.choices ?? {}) as Record<string, string>, markup, cat.timeTrackable);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const missing = missingFromCatalog(rows, cat);
  if (missing.length) {
    return NextResponse.json({ error: `JobTread has no ${missing.join(", ")}. Nothing was written.` }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was written to JobTread.",
    });
  }

  const journal = await openJournal(ROUTE);
  const result = await applyBudgetImport(cfg, jobId, rows, budget.groups, cat, markup, journal);
  clearJobCostCaches(); // budget lines are the coding targets and the headroom
  return NextResponse.json({ wrote: true, ...result }, { status: result.failed ? 502 : 200 });
}
