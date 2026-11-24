/**
 * Home's Inbox widget: the office mailbox's inbox, plus the mail Keillor's
 * account forwards to it. Pure and client-safe; the read is
 * `/api/home/inbox`, over appscript `chatSearchMail` (read-only).
 *
 * The forwarded mail skips the office inbox by a Gmail filter on office@ and
 * carries the label `KEILLOR_LABEL`. So the widget runs two searches that
 * never overlap: the inbox without that label, and the label itself.
 */

/** The Gmail label office@'s filter puts on mail forwarded from keillor@. */
export const KEILLOR_LABEL = "Keillor";

export type InboxSource = "office" | "keillor";

export const INBOX_QUERIES: Record<InboxSource, string> = {
  office: `in:inbox -label:${KEILLOR_LABEL}`,
  keillor: `label:${KEILLOR_LABEL}`,
};

/** One thread as appscript `chatSearchMail` returns it. */
export interface RawThread {
  threadId?: string;
  subject?: string;
  from?: string;
  date?: string;
  messages?: number;
  attachments?: string[];
  text?: string;
}

export interface InboxThread {
  threadId: string;
  source: InboxSource;
  subject: string;
  sender: string;
  date: string;
  messages: number;
  attachments: number;
  preview: string;
}

/** Characters of the newest message shown under the subject. */
export const PREVIEW_CHARS = 140;

/** `"Jane Doe" <jane@x.com>` → `Jane Doe`; a bare address stays an address. */
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return from.trim();
  return m[1].trim() || m[2].trim();
}

/**
 * Both searches → one list, newest first. A thread found by both (a filter
 * change mid-read) shows once, as the Keillor copy.
 */
export function mergeInbox(found: Record<InboxSource, RawThread[]>): InboxThread[] {
  const byId = new Map<string, InboxThread>();
  for (const source of ["office", "keillor"] as InboxSource[]) {
    for (const t of found[source] ?? []) {
      const id = String(t.threadId ?? "");
      if (!id) continue;
      byId.set(id, {
        threadId: id,
        source,
        subject: String(t.subject ?? "").trim() || "(no subject)",
        sender: senderName(String(t.from ?? "")),
        date: String(t.date ?? ""),
        messages: Number(t.messages) || 1,
        attachments: Array.isArray(t.attachments) ? t.attachments.length : 0,
        preview: String(t.text ?? "").slice(0, PREVIEW_CHARS),
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** The thread in the office account's Gmail. */
export const threadUrl = (threadId: string) =>
  `https://mail.google.com/mail/u/?authuser=office%40ascentbuildingco.com#all/${threadId}`;

/** The Gmail app on an iPhone or iPad. It opens the app, not one thread:
 *  Gmail has no app link to a thread. */
export const GMAIL_APP_URL = "googlegmail://";

/** An iPhone or iPad, the only phones the Gmail app link works on. iPadOS
 *  reports itself as a Mac, so a Mac with a touch screen counts. */
export function isAppleTouch(ua: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** One message as appscript `chatReadThread` returns it. */
export interface ThreadMessage {
  from: string;
  to: string;
  date: string;
  attachments: { name: string; type?: string; attachmentId?: string }[];
  text: string;
}

/** An attachment the Log invoice button can open: a PDF with an id
 *  ("<messageId>:<index>", from appscript `chatReadThread`). */
export function isPdfAttachment(a: { name: string; type?: string; attachmentId?: string }): boolean {
  return Boolean(a.attachmentId) && (a.type === "application/pdf" || /\.pdf$/i.test(a.name));
}

export interface ThreadRead {
  subject: string;
  messageCount: number;
  olderLeftOut: number;
  messages: ThreadMessage[];
}

/**
 * The job tags Home's Inbox widget applies (appscript `tagEmailThread`). The
 * invoice tag is left out: the widget logs an invoice directly (Log invoice,
 * appscript `logInvoice`) instead of waiting for the tag scan. Each
 * is a tag the office already applies by hand in Gmail; the Apps Script scans
 * that act on them are unchanged. `job` = the kind names a JobTread job.
 */
export const TAG_KINDS = [
  { kind: "todo", label: "To-do on a job", job: true, note: "The next scan makes a JobTread to-do on the job." },
  { kind: "ai-todo", label: "AI to-do (_todo)", job: false, note: "Claude picks the job and writes the to-do on the next scan." },
  { kind: "processed", label: "Processed (already in JobTread)", job: true, note: "Tags the job and Processed. Nothing is logged." },
  { kind: "not-invoice", label: "Not an invoice", job: false, note: "Drops it from the To log list." },
] as const;

export type TagKind = (typeof TAG_KINDS)[number]["kind"];

export const isTagKind = (v: unknown): v is TagKind => TAG_KINDS.some((t) => t.kind === v);
export const tagNeedsJob = (k: TagKind) => TAG_KINDS.find((t) => t.kind === k)?.job ?? true;
