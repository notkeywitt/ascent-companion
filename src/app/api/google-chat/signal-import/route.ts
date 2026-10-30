import { NextRequest, NextResponse } from "next/server";

import { cleanSignalBatch, importSignalMessages, signalSecretOk } from "@/lib/signalImport";

// Signal group messages into AscentBot's memory (src/lib/signalImport.ts).
// The office Mac mini's scripts/signal-sync/signal_sync.py POSTs here twice a
// day. It sits under /api/google-chat, which src/middleware.ts lists as
// PUBLIC, so it checks its own bearer secret: SIGNAL_IMPORT_SECRET.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!signalSecretOk(req.headers.get("authorization") ?? "", process.env.SIGNAL_IMPORT_SECRET ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const batch = cleanSignalBatch(body);
  if ("error" in batch) return NextResponse.json({ error: batch.error }, { status: 400 });
  const result = await importSignalMessages(batch.messages);
  console.log(`[signal-import] ${result.stored} stored, ${result.skipped} already kept`);
  return NextResponse.json({ ok: true, ...result });
}
