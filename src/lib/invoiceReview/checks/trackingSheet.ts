/**
 * A LEGACY CLIENT'S GOOGLE TRACKING SHEET DISAGREES WITH JOBTREAD.
 *
 * The comparison is sheetCompare.ts; the cells come from sheetEvidence.ts.
 * This check only turns each discrepancy into a finding, so it gets what every
 * finding gets: an age, a verdict, a ruling, a place in the breakdown.
 *
 * Month-scoped: the sheets are read once for the whole review, never in the
 * one-job "Check this job" gate. No sheets on the evidence means the read was
 * skipped or failed (a warning says which), so the check says nothing.
 */
import { defineMonthCheck } from "../checkTypes";
import type { SheetIssueKind } from "../sheetCompare";
import { findingKey, type Finding } from "../types";

export type TrackingSheetConfig = Record<string, never>;

const FIX: Record<SheetIssueKind, string> = {
  "not-synced": "Re-sync the job's Tracking Sheet. If it persists, the bill line named here is the cause.",
  "uncoded-in-jt": "Code the line in JobTread, then re-sync.",
  "no-column": "Add the code's column on the Sub/Vendor Invoices tab.",
  "column-total-off": "Repair the column's FILTER or total formula.",
  "not-on-tracking-tab": "Add the code's row on the Tracking Sheet tab.",
  "tracking-tab-off": "Fix that cell's lookup formula.",
  "tracking-total-off": "Fix the SUM range.",
  "labor-hours-off": "Re-run the labor report. Check entries coded or dated after it ran.",
  "labor-rate-off": "Decide which is right: the sheet's code rate, or the person's pay rate on the entries.",
  "labor-cost-off": "Repair the formula on that Labor row.",
  "labor-row-math": "Repair the formula on that Labor row.",
  "labor-total-off": "Repair the Labor tab's totals formula.",
  "sheet-error": "Repair the formula in that cell.",
};

/** Kinds reported once per sheet, with the label in the title. */
const GROUPED: Partial<Record<SheetIssueKind, string>> = {
  "not-synced": "not synced",
  "labor-hours-off": "labor hours off",
};

export const SHEET_KINDS = (Object.keys(FIX) as SheetIssueKind[]).map((k) => `sheet-${k}` as const);

export const trackingSheetCheck = defineMonthCheck<TrackingSheetConfig>({
  id: "tracking-sheet",
  title: "Tracking Sheet matches JobTread",
  description: "Each legacy client's Google Tracking Sheet agrees with JobTread, bills and labor.",
  kinds: SHEET_KINDS,
  scope: "month",
  run({ month }) {
    const out: Finding[] = [];
    for (const sheet of month.sheets ?? []) {
      const job = month.jobs.find((j) => j.jobId === sheet.jobId);
      // One finding per sheet for these kinds, not one per code: the cure is one re-sync or re-run.
      for (const [gk, label] of Object.entries(GROUPED) as [SheetIssueKind, string][]) {
        const group = sheet.result.issues.filter((i) => i.kind === gk);
        if (!group.length) continue;
        out.push({
          jobId: sheet.jobId,
          jobName: job?.jobName ?? sheet.label,
          customerName: job?.customerName ?? "",
          invoiceId: "",
          invoiceNumber: "",
          key: findingKey(`sheet-${gk}` as const, sheet.jobId, "all"),
          kind: `sheet-${gk}` as const,
          severity: "error",
          title: `Tracking Sheet ${label} (${group.length} code${group.length === 1 ? "" : "s"})`,
          detail: `${group.map((i) => i.detail).join(" ")} ${FIX[gk]}`,
          amount: group.reduce((n, i) => n + Math.abs((i.expected ?? 0) - (i.sheet ?? 0)), 0) || undefined,
          sourceLink: sheet.url,
          sourceLabel: "Open the sheet",
        });
      }
      for (const issue of sheet.result.issues) {
        if (issue.kind in GROUPED) continue;
        const kind = `sheet-${issue.kind}` as const;
        const gap =
          issue.expected != null && issue.sheet != null
            ? Math.abs(issue.expected - issue.sheet)
            : Math.abs(issue.expected ?? issue.sheet ?? 0);
        const behind = (issue.lines ?? [])
          .map((l) => `${l.vendor} ${l.bill} (${l.status}) ${l.name}: $${l.cost.toFixed(2)}`)
          .join("; ");
        out.push({
          jobId: sheet.jobId,
          jobName: job?.jobName ?? sheet.label,
          customerName: job?.customerName ?? "",
          invoiceId: "",
          invoiceNumber: "",
          key: findingKey(kind, sheet.jobId, `${issue.code}|${issue.where}`),
          kind,
          severity: "error",
          title: `Tracking Sheet: ${issue.code || issue.where} ${issue.kind.replace(/-/g, " ")}`,
          detail: `${issue.detail} (${issue.where}) ${FIX[issue.kind]}${behind ? ` JobTread lines: ${behind}.` : ""}`,
          amount: gap || undefined,
          sourceLink: sheet.url,
          sourceLabel: "Open the sheet",
        });
      }
    }
    return out;
  },
});
