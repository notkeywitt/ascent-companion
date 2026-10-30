import { NextRequest, NextResponse } from "next/server";

import { requireBotAdmin } from "@/lib/botAdmin";
import { listSignalChats, setSignalChatRule, type SignalRule } from "@/lib/signalChats";

/**
 * The AscentBot page's Signal chats: every chat the office Mac mini reported,
 * and what AscentBot may do with each (src/lib/signalChats.ts). Companion-DB
 * writes only, never JobTread. Gated by the `ascentbot` view.
 */

const FORBIDDEN = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function GET() {
  if (!(await requireBotAdmin()).ok) return FORBIDDEN();
  return NextResponse.json({ chats: await listSignalChats() });
}

/** { chat, rule: "" | "job" | "office" | "skip", jobId?, jobName? }  assign one chat. */
export async function POST(req: NextRequest) {
  const me = await requireBotAdmin();
  if (!me.ok) return FORBIDDEN();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const chat = String(body?.chat ?? "").trim();
  const rule = String(body?.rule ?? "") as SignalRule;
  if (!chat) return bad("Name the chat.");
  if (!["", "job", "office", "skip"].includes(rule)) return bad("Unknown choice.");
  const jobId = String(body?.jobId ?? "").trim();
  if (rule === "job" && !jobId) return bad("Pick a job.");
  try {
    await setSignalChatRule(chat, { rule, jobId, jobName: String(body?.jobName ?? "").trim() }, me.email);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
  return NextResponse.json({ chats: await listSignalChats() });
}
