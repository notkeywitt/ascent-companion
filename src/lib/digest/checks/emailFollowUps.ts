/**
 * Check "email-followups" (Follow-ups) — inbound conversations nobody answered.
 *
 * THE TEST IS MECHANICAL ON PURPOSE. Whether an email "needs" a reply is a
 * judgment the person reading the digest makes in a second and a script gets
 * wrong constantly. So the check only asserts facts it can verify: the newest
 * message on an inbox thread came from outside the company, nobody here has
 * sent anything since, the sender isn't an automated no-reply address, and it
 * has been at least `minBusinessDays` business days. Everything after that is
 * the reader's call.
 *
 * BUSINESS days, not calendar days: a Friday-afternoon email is not overdue on
 * Sunday morning. The Apps Script side counts them (weekends excluded; holidays
 * are not modelled) and this check applies the threshold, so changing "flag
 * after 2 days" is a settings edit, not a script deploy.
 *
 * READ-ONLY: Gmail is searched. Nothing is sent, labeled, archived or marked read.
 */
import { callAppsScript } from "@/lib/appsScript";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { EmailFollowUpsConfig } from "../settings";

interface FollowUpThread {
  threadId?: string;
  subject?: string;
  from?: string;
  fromAddress?: string;
  fromName?: string;
  lastMessageAt?: string;
  ageDays?: number;
  businessDaysOld?: number;
  messageCount?: number;
  threadUrl?: string;
}
interface FollowUpResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  scanned?: number;
  threads?: FollowUpThread[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const emailFollowUpsCheck = defineCheck<EmailFollowUpsConfig>({
  id: "email-followups",
  title: "Waiting on a Reply",
  category: "followup",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as EmailFollowUpsConfig,

  async run({ config, log }): Promise<CheckResult> {
    const r = await callAppsScript<FollowUpResponse>({
      action: "digestFollowUps",
      days: config.lookbackDays,
      officeAddresses: config.officeAddresses,
      ignorePatterns: config.ignoreSenders,
    });
    if (r.error) return checkError(`Couldn't read the inbox: ${r.error}`);
    if (r.data?.ok === false) return checkError(r.data.error || "Gmail scan failed.");

    const threads = r.data?.threads ?? [];
    log(`${r.data?.scanned ?? 0} inbox thread(s) examined; ${threads.length} unanswered`);

    const overdue = threads.filter((t) => (t.businessDaysOld ?? 0) >= config.minBusinessDays);
    overdue.sort((a, b) => (b.businessDaysOld ?? 0) - (a.businessDaysOld ?? 0));

    if (overdue.length === 0) {
      return allClear(
        threads.length === 0
          ? `Nothing unanswered in the last ${config.lookbackDays} days.`
          : `${plural(threads.length, "thread")} still unanswered, none older than ${plural(config.minBusinessDays, "business day")}.`,
      );
    }

    const items: DigestItem[] = overdue.map((t) => ({
      title: `${t.fromName || t.fromAddress || "Unknown sender"} — ${t.subject ?? "(no subject)"}`,
      detail:
        `Last message ${(t.lastMessageAt ?? "").slice(0, 10)} from ${t.from ?? "an unknown sender"}, ` +
        `${plural(t.businessDaysOld ?? 0, "business day")} ago with no reply from us. ` +
        `${plural(t.messageCount ?? 1, "message")} in the thread.`,
      sourceLink: t.threadUrl,
      sourceLabel: "Gmail thread",
      date: (t.lastMessageAt ?? "").slice(0, 10),
      group: (t.businessDaysOld ?? 0) >= config.minBusinessDays * 2 ? "Overdue" : "Waiting",
    }));

    const oldest = overdue[0]?.businessDaysOld ?? 0;
    return {
      status: "warning",
      items,
      summary: `${plural(overdue.length, "conversation")} waiting on a reply — the oldest for ${plural(oldest, "business day")}.`,
    };
  },
});
