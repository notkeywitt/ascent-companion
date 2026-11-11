import { NextRequest, NextResponse } from "next/server";

import { recordSignalRun, reportSignalChats, signalRunStatus } from "@/lib/signalChats";
import { cleanChatReport, cleanSignalBatch, importSignalMessages, signalSecretOk } from "@/lib/signalImport";

// Signal messages into AscentBot's memory (src/lib/signalImport.ts). The
// office Mac mini's scripts/signal-sync/signal_sync.py POSTs here every hour:
// { chats } to report its chats and get their rules, then { messages }. It
// sits under /api/google-chat, which src/middleware.ts lists as PUBLIC, so it
// checks its own bearer secret: SIGNAL_IMPORT_SECRET.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!signalSecretOk(req.headers.get("authorization") ?? "", process.env.SIGNAL_IMPORT_SECRET ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  // The Mac's one-minute poll: has someone pressed "Run now" on the AscentBot page?
  if (body && "poll" in body) return NextResponse.json({ ok: true, requestedAt: (await signalRunStatus()).requestedAt });
  // The Mac finished a requested run.
  if (body && "ran" in body) {
    await recordSignalRun(String(body.ran ?? ""));
    return NextResponse.json({ ok: true });
  }
  if (body && "chats" in body) {
    const report = cleanChatReport(body.chats);
    if ("error" in report) return NextResponse.json({ error: report.error }, { status: 400 });
    return NextResponse.json({ ok: true, chats: await reportSignalChats(report.chats) });
  }
  const batch = cleanSignalBatch(body?.messages);
  if ("error" in batch) return NextResponse.json({ error: batch.error }, { status: 400 });
  const result = await importSignalMessages(batch.messages);
  console.log(`[signal-import] ${result.stored} stored, ${result.skipped} already kept, ${result.refused} refused`);
  return NextResponse.json({ ok: true, ...result });
}
