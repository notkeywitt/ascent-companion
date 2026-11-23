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
