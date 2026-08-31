/**
 * Check "email-signals" (To-Do) — appointments and action items mentioned in
 * recent inbox email, found by ONE Claude pass.
 *
 * "Waiting on a Reply" (email-followups) already covers threads nobody
 * answered. This check covers a different thing: a date, a request, or a
 * promise SAID in an email, whether or not that thread needs a reply — "site
 * visit Thursday at 2" or "I'll send the updated quote by Friday" should show
 * up here even if the thread is otherwise finished.
 *
 * ⚠️ THE ONE CHECK THAT SENDS EMAIL BODY TEXT OFF-SITE. Every other check reads
 * sender/subject/date only. This one has to read some body text — no rule can
 * find "let's meet Thursday" — so it does, but narrowly: the body is truncated
 * (`EmailSignalsConfig.maxBodyChars`) and quote-stripped before this check ever
 * sees it (Apps Script side, `_jtdStripQuoted`), and only the EXTRACTED result
 * (a title, a date/time, a yes/no on whose action it is) is kept — the body
 * text itself is discarded after the one Claude call. See the comment on
 * `extractEmailSignalsWithClaude` in src/lib/digest/claude.ts.
 *
 * READ-ONLY: Gmail is searched and read, never labeled, archived, or sent.
 */
import { callAppsScript } from "@/lib/appsScript";
import { extractEmailSignalsWithClaude } from "../claude";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { EmailSignalsConfig } from "../settings";

interface DigestEmailContent {
  threadId?: string;
  messageId?: string;
  subject?: string;
  from?: string;
  fromName?: string;
  date?: string;
  body?: string;
  truncated?: boolean;
  threadUrl?: string;
}
interface DigestEmailContentResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  emails?: DigestEmailContent[];
}

export const emailSignalsCheck = defineCheck<EmailSignalsConfig>({
  id: "email-signals",
  title: "From Your Email",
  category: "todo",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as EmailSignalsConfig,

  async run({ config, settings, log }): Promise<CheckResult> {
    const r = await callAppsScript<DigestEmailContentResponse>(
      {
        action: "digestEmailContent",
        days: config.lookbackDays,
        limit: config.maxEmails,
        maxChars: config.maxBodyChars,
      },
      { timeoutMs: settings.appsScriptTimeoutMs },
    );
    if (r.error) return checkError(`Couldn't read email content: ${r.error}`);
    if (r.data?.ok === false) return checkError(r.data.error || "Gmail read failed.");

    const emails = r.data?.emails ?? [];
    log(`${emails.length} recent inbox email(s) read for appointments/action items`);
    if (emails.length === 0) {
      return allClear(`No recent inbox email in the last ${config.lookbackDays} days.`);
    }

    let extraction;
    try {
      extraction = await extractEmailSignalsWithClaude(
        emails.map((e) => ({
          subject: e.subject ?? "",
          from: e.from ?? "",
          date: e.date ?? "",
          body: e.body ?? "",
        })),
      );
    } catch (e) {
      return checkError(`Claude extraction failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!extraction) {
      return checkError("Claude isn't configured, so email can't be scanned for appointments/action items.");
    }
    log(`Claude found ${extraction.appointments.length} appointment(s), ${extraction.actionItems.length} action item(s)`);

    const items: DigestItem[] = [];
    for (const a of extraction.appointments) {
      const e = emails[a.emailIndex];
      if (!e) continue;
      items.push({
        title: a.title,
        detail: `Mentioned by ${e.fromName || e.from || "someone"} in "${e.subject}"${a.time ? ` — ${a.time}` : ""}.`,
        sourceLink: e.threadUrl,
        sourceLabel: "Gmail thread",
        date: a.date,
        group: "Appointments mentioned",
      });
    }
    for (const a of extraction.actionItems) {
      const e = emails[a.emailIndex];
      if (!e) continue;
      items.push({
        title: a.title,
        detail:
          `${a.owner === "us" ? "Asked of us" : "We're on the hook"} by ${e.fromName || e.from || "someone"}` +
          ` in "${e.subject}"${a.dueHint ? ` — ${a.dueHint}` : ""}.`,
        sourceLink: e.threadUrl,
        sourceLabel: "Gmail thread",
        group: a.owner === "us" ? "Action items — ours to do" : "Action items — they owe us",
      });
    }

    if (items.length === 0) {
      return allClear(`Scanned ${emails.length} recent email(s) — nothing found needing action.`);
    }
    return {
      status: "warning",
      items,
      summary: `${extraction.appointments.length} appointment(s) and ${extraction.actionItems.length} action item(s) found in recent email.`,
    };
  },
});
