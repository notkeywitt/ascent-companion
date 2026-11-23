import { NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { INBOX_QUERIES, mergeInbox, type InboxSource, type RawThread } from "@/lib/officeInbox";

/**
 * HOME'S INBOX — read-only. The office inbox's newest threads, plus the mail
 * forwarded from keillor@ (label Keillor), as one list. Two appscript
 * `chatSearchMail` calls (10 threads each, GmailApp search, changes nothing).
 * Gated by the `office-inbox` view (admin).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function search(source: InboxSource): Promise<RawThread[]> {
  const r = await callAppsScript<{ ok?: boolean; mail?: RawThread[]; error?: string }>(
    { action: "chatSearchMail", query: INBOX_QUERIES[source], limit: 10 },
    { timeoutMs: 25_000, retry: false },
  );
  if (r.error || !r.data?.ok) throw new Error(r.error || r.data?.error || "Could not read the mailbox.");
  return r.data.mail ?? [];
}

export async function GET() {
  const [office, keillor] = await Promise.allSettled([search("office"), search("keillor")]);
  if (office.status === "rejected" && keillor.status === "rejected") {
    const e = office.reason;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the mailbox." }, { status: 502 });
  }
  return NextResponse.json({
    threads: mergeInbox({
      office: office.status === "fulfilled" ? office.value : [],
      keillor: keillor.status === "fulfilled" ? keillor.value : [],
    }),
    partial: office.status === "rejected" || keillor.status === "rejected",
  });
}
