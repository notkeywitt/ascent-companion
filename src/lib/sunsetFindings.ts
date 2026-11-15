import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { sunsetStatementLinks, sunsetStatements } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { report, type FindingInput } from "@/lib/findings";
import { money } from "@/lib/money";
import { reconcileState, type ReconcileResult } from "@/lib/sunsetReconcile";

/**
 * The Sunset statement reconcile, read from Apps Script, and its rows in the
 * findings inbox (source `sunset-unreconciled`). Two callers: the /payments read
 * (`/api/sunset-statements/reconcile`) and the end of the digest run, so the
 * rows refresh twice a day with no page open.
 *
 * Read-only on every side: Apps Script `reconcileSunsetStatements` reads the
 * sheets and runs one Pave query; the only write is to the companion `findings`
 * table.
 */

/** Sheet sum + a live JobTread bill-status walk; under the route's 45 s maxDuration. */
export const SUNSET_RECONCILE_TIMEOUT_MS = 38_000;

/** The Apps Script reconcile, with the office's links. Throws on a failed read. */
export async function readSunsetReconcile(timeoutMs = SUNSET_RECONCILE_TIMEOUT_MS) {
  await ensureDb();
  const links = (await db.select().from(sunsetStatementLinks)).map((l) => ({
    statementId: l.statementExpId,
    line: l.lineNumber,
    docId: l.docId,
    number: l.invoiceNumber,
  }));
  return callAppsScriptOrThrow({ action: "reconcileSunsetStatements", links }, { timeoutMs });
}

/**
 * The same green rule the page draws (lib/sunsetReconcile), over the unpaid
 * statements in the companion cache. Call it only after a read that answered:
 * an empty map resolves every row.
 * ponytail: the cache keeps a statement removed from the sheet, so its row
 * stays until someone dismisses it. Filter by the sheet list if that happens.
 */
export async function reportSunsetUnreconciled(rcBy: Record<string, ReconcileResult>) {
  const unpaid = await db.select().from(sunsetStatements).where(eq(sunsetStatements.status, "unpaid"));
  const items: FindingInput[] = unpaid.flatMap((s) => {
    const st = reconcileState(s, rcBy[s.expId]);
    if (st.reconciled) return [];
    const why = !st.cmpReady
      ? "not checked yet, the statement is still being read"
      : st.diff !== null && Math.abs(st.diff) > 0.01
        ? `off by ${money(st.diff)}`
        : st.matchIssues
          ? `${st.matchIssues} invoice${st.matchIssues === 1 ? "" : "s"} do not match`
          : "no invoices found for it";
    return [
      {
        key: s.expId,
        kind: "sunset-unreconciled",
        subject: s.project,
        title: `Sunset statement ${s.statementDate}${s.project ? ` (${s.project})` : ""} does not reconcile: ${why}`,
        link: "/payments",
      },
    ];
  });
  await report("sunset-unreconciled", items);
}

/** Read and report, for the digest timer. Never throws; returns a log line. */
export async function refreshSunsetFindings(): Promise<string> {
  try {
    const resp = await readSunsetReconcile();
    if (!resp.reconciliation || typeof resp.reconciliation !== "object") {
      return "sunset-unreconciled: no reconciliation in the reply, nothing reported";
    }
    await reportSunsetUnreconciled(resp.reconciliation as Record<string, ReconcileResult>);
    return "sunset-unreconciled: reported";
  } catch (e) {
    return `sunset-unreconciled: not refreshed (${e instanceof Error ? e.message : String(e)})`;
  }
}
