import { NextResponse } from "next/server";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { report, type FindingInput } from "@/lib/findings";
import { money } from "@/lib/money";

// GET /api/sunset-duplicates
// Runs the Apps Script Sunset duplicate-bill scan and returns its structured
// findings for inline display on the Sunset Statements page. Read-only — the scan
// queries JobTread and writes nothing. Kept as its own route (a full org-wide JT
// scan) so it never slows the statements list.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 60; // org-wide JT vendorBill scan, paged

interface ScanFinding {
  kind: "amount" | "invoiceNo";
  why?: string;
  amount?: number;
  invoiceNo?: string;
  members?: unknown[];
}
interface ScanJob {
  jobId: string;
  jobName: string;
  findings?: ScanFinding[];
}

/** One inbox row per flagged group on a job. */
function jobFindings(j: ScanJob): FindingInput[] {
  return (j.findings ?? []).map((f) => {
    const n = f.members?.length ?? 0;
    const head =
      f.kind === "amount"
        ? `${n} bills at ${money(f.amount ?? 0)}${f.why ? ` — ${f.why}` : ""}`
        : `Invoice #${f.invoiceNo} on ${n} JobTread docs`;
    return {
      key: `${j.jobId}|${f.kind}|${f.kind === "amount" ? f.amount : f.invoiceNo}`,
      kind: `sunset-duplicate-${f.kind}`,
      subject: j.jobId,
      title: `${j.jobName}: ${head}`,
      link: "/payments",
    };
  });
}

export async function GET() {
  try {
    const resp = await callAppsScriptOrThrow(
      { action: "sunsetDuplicates" },
      // Org-wide paged JT scan; stay under this route's maxDuration (60s).
      { timeoutMs: 50_000 },
    );
    // Into the findings inbox. Only a scan that finished: a failed one reports
    // nothing, so it cannot resolve the rows it did not see.
    if (resp?.ok !== false && Array.isArray(resp?.jobs)) {
      await report("sunset-duplicates", resp.jobs.flatMap(jobFindings)).catch(() => {});
    }
    return NextResponse.json(resp);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
