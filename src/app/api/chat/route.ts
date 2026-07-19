import type Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

import { hasGrant } from "@/lib/config";
import { runChat, type ChatEvent } from "@/lib/anthropic";

// Node runtime (the JobTread client + SDK use Node APIs); allow headroom for the
// tool-use loop. Auth is enforced by src/middleware.ts, which returns 401 JSON
// for an unauthenticated /api/* request before this handler runs.
export const runtime = "nodejs";
export const maxDuration = 60;

interface InMsg {
  role: "user" | "assistant";
  content: string;
}

/** Keep only well-formed user/assistant text turns, in order. */
function sanitize(raw: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(raw)) return [];
  const out: Anthropic.MessageParam[] = [];
  for (const m of raw as InMsg[]) {
    if ((m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string") {
      const content = m.content.trim();
      if (content) out.push({ role: m.role, content });
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to the environment and restart." },
      { status: 400 },
    );
  }
  if (!hasGrant()) {
    return NextResponse.json(
      { error: "JT_GRANT_KEY is not set. The assistant needs JobTread access to answer." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const messages = sanitize(body?.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "Send a non-empty conversation ending in a user message." },
      { status: 400 },
    );
  }
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() || undefined : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runChat({ messages, jobId, onEvent: send });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "Chat failed." });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
