import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

/**
 * ONE THREAD for Home's Inbox widget — read-only. Appscript `chatReadThread`
 * (each message's sender, date, own text and attachment names; quoted replies
 * cut). Gated by the `office-inbox` view, like `/api/home/inbox`.
 *
 * GET /api/home/inbox/thread?id=<threadId>
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!/^[0-9a-f]{8,24}$/i.test(id)) {
    return NextResponse.json({ error: "Pass a thread id." }, { status: 400 });
  }
  const r = await callAppsScript<{ ok?: boolean; error?: string }>(
    { action: "chatReadThread", threadId: id },
    { timeoutMs: 25_000, retry: false },
  );
  if (r.error || !r.data?.ok) {
    return NextResponse.json({ error: r.error || r.data?.error || "Could not read the email." }, { status: 502 });
  }
  return NextResponse.json(r.data);
}
