/**
 * How a review finding enters the findings inbox (lib/findings). Shared by the
 * monthly run (run.ts) and the pre-send gate (/api/invoice-review/job).
 * Pure, so the rules are tested rather than trusted.
 */
import { laborFocusHref } from "@/app/trackingsheet/findingFocus";
import { hubHref } from "@/lib/hubUrl";
import type { FindingInput, ReportKeep } from "@/lib/findings";

import { laborRateCheck } from "./checks/laborRate";
import { mailCaptureCheck } from "./checks/mailCapture";
import { SHEET_KINDS } from "./checks/trackingSheet";
import type { Finding, MonthEvidence } from "./types";

/**
 * The rows a report must leave as they were, because the evidence behind them
 * did not load: the mail kinds when the mailbox was not searched in full, the
 * labor-rate kinds without a rate card, the sheet kinds without the sheet
 * list, the kinds of a check that threw, and every row of a job with a
 * failed read. Everything else resolves as usual, so one failed read does not
 * freeze the whole month.
 */
export function unreadParts(e: MonthEvidence): ReportKeep {
  const kinds: string[] = [];
  if (!e.emailChecked || e.mailTruncated) kinds.push(...mailCaptureCheck.kinds);
  if (!e.laborRates) kinds.push(...laborRateCheck.kinds);
  if (e.sheetsUnread) kinds.push(...SHEET_KINDS);
  kinds.push(...(e.failedKinds ?? []));
  return { kinds, subjects: e.unreadJobIds ?? [] };
}

/**
 * The inbox row for one finding. `link` is the most direct place to fix it:
 * the bill or the labor entries on the job's board, else the finding's own
 * page (the PDF, the mail thread, the sheet), else the job and month on the
 * Jobs Hub, else the month's review. `hubFirst` (pre-send) prefers the hub
 * over the finding's own page, because opening the job there re-runs the
 * check. `fixAction` carries the bill id, so an inline fix need not parse `key`.
 */
export function inboxRow(f: Finding, ym: string, hubFirst = false): FindingInput {
  const billId = f.target?.kind === "bill" ? f.target.billId : "";
  let link: string;
  if (f.jobId && billId) link = hubHref(f.jobId, ym, { bill: billId });
  else if (f.jobId && f.target?.kind === "labor") link = laborFocusHref(f.jobId, ym, f.target);
  else if (f.sourceLink && !(hubFirst && f.jobId)) link = f.sourceLink;
  else if (f.jobId) link = hubHref(f.jobId, ym);
  else link = `/invoice-review?ym=${ym}`;
  return {
    key: f.key,
    kind: f.kind,
    subject: f.jobId,
    severity: f.severity,
    title: f.jobName ? `${f.jobName}: ${f.title}` : f.title,
    link,
    fixAction: billId,
  };
}
