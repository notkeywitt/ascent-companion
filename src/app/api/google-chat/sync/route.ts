import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { syncAllSpaces } from "@/lib/chatSync";
import { canReadSpaces, vercelOidcToken } from "@/lib/googleChatPost";

// AscentBot's daily read of every job space (src/lib/chatSync.ts), so what
// people said reaches its memory even on a day nobody asks it anything.
// Vercel Cron calls it (vercel.json). It sits under /api/google-chat, which
// src/middleware.ts lists as PUBLIC, so it checks the scheduler's own secret
// here: CRON_SECRET (or DIGEST_CRON_SECRET), sent by Vercel Cron as a bearer.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function fromScheduler(req: NextRequest): boolean {
  const expected = (process.env.CRON_SECRET || process.env.DIGEST_CRON_SECRET || "").trim();
  const header = req.headers.get("authorization") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!fromScheduler(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const oidc = vercelOidcToken(req.headers);
  if (!canReadSpaces(oidc)) return NextResponse.json({ ok: true, skipped: "space reading is off" });
  const result = await syncAllSpaces(oidc);
  console.log(`[chat-sync] ${result.spaces} spaces, ${result.stored} messages kept, ${result.failed} failed`);
  return NextResponse.json({ ok: true, ...result });
}
