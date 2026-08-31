import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { digestTodos, digestIgnoreRules, digestReplies } from "@/db/schema";
import { digestDateKey } from "@/lib/digest/run";
import { parseDigestReplyWithClaude, type DigestReplyAction } from "@/lib/digest/claude";

/**
 * POST /api/digest/reply — the digest's reply box. Turns a free-text note
 * ("remind me about the L&I thing tomorrow, ignore emails from so-and-so") into
 * durable state: a row in `digest_todos` and/or `digest_ignore_rules`, read back
 * by the `digest-todos` and `email-followups` checks on the NEXT digest run —
 * this route never touches today's already-stored digest.
 *
 * Session-gated (unlike /api/digest/run, which a scheduler with no session must
 * call) — the office is the only caller, from the home screen's reply box.
 *
 * Claude proposes actions against today's actual open todos/ignore rules (see
 * parseDigestReplyWithClaude); this route re-validates every referenced id
 * against that same set before writing anything, so a hallucinated id can't
 * touch a row that doesn't exist or was already closed.
 */
export const dynamic = "force-dynamic";

interface AppliedAction {
  type: DigestReplyAction["type"];
  summary: string; // one line for the confirmation shown back to the office
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Nothing to reply with." }, { status: 400 });

  await ensureDb();
  const today = digestDateKey();
  const now = new Date().toISOString();

  const [openTodoRows, ruleRows] = await Promise.all([
    db.select({ id: digestTodos.id, text: digestTodos.text }).from(digestTodos).where(eq(digestTodos.status, "open")),
    db
      .select({ id: digestIgnoreRules.id, pattern: digestIgnoreRules.pattern })
      .from(digestIgnoreRules)
      .where(and(eq(digestIgnoreRules.kind, "email_sender"), eq(digestIgnoreRules.active, true))),
  ]);

  let parsed: { actions: DigestReplyAction[] } | null = null;
  try {
    parsed = await parseDigestReplyWithClaude(text, {
      today,
      openTodos: openTodoRows,
      activeIgnoreRules: ruleRows,
    });
  } catch (e) {
    console.error("[digest reply] parse failed:", e);
  }

  if (!parsed) {
    return NextResponse.json(
      { error: "Couldn't understand that just now — the note was saved but nothing was set up automatically." },
      { status: 502 },
    );
  }

  const validTodoIds = new Set(openTodoRows.map((r) => r.id));
  const validRuleIds = new Set(ruleRows.map((r) => r.id));
  const applied: AppliedAction[] = [];

  for (const action of parsed.actions) {
    try {
      if (action.type === "add_todo" && action.text) {
        await db.insert(digestTodos).values({
          text: action.text,
          status: action.snoozeUntil ? "snoozed" : "open",
          snoozeUntil: action.snoozeUntil ?? "",
          source: "reply",
          createdAt: now,
          updatedAt: now,
        });
        applied.push({
          type: action.type,
          summary: action.snoozeUntil
            ? `Reminder set for ${action.snoozeUntil}: ${action.text}`
            : `Reminder added: ${action.text}`,
        });
      } else if (action.type === "complete_todo" && action.todoId && validTodoIds.has(action.todoId)) {
        await db
          .update(digestTodos)
          .set({ status: "done", completedAt: now, updatedAt: now })
          .where(eq(digestTodos.id, action.todoId));
        const matched = openTodoRows.find((r) => r.id === action.todoId);
        applied.push({ type: action.type, summary: `Marked done: ${matched?.text ?? "a reminder"}` });
      } else if (
        action.type === "snooze_todo" &&
        action.todoId &&
        action.snoozeUntil &&
        validTodoIds.has(action.todoId)
      ) {
        await db
          .update(digestTodos)
          .set({ status: "snoozed", snoozeUntil: action.snoozeUntil, updatedAt: now })
          .where(eq(digestTodos.id, action.todoId));
        const matched = openTodoRows.find((r) => r.id === action.todoId);
        applied.push({
          type: action.type,
          summary: `Snoozed until ${action.snoozeUntil}: ${matched?.text ?? "a reminder"}`,
        });
      } else if (action.type === "add_ignore_rule" && action.pattern) {
        await db.insert(digestIgnoreRules).values({
          kind: "email_sender",
          pattern: action.pattern,
          reason: action.reason ?? "",
          active: true,
          createdAt: now,
        });
        applied.push({ type: action.type, summary: `Will ignore emails matching "${action.pattern}"` });
      } else if (action.type === "remove_ignore_rule" && action.ruleId && validRuleIds.has(action.ruleId)) {
        await db.update(digestIgnoreRules).set({ active: false }).where(eq(digestIgnoreRules.id, action.ruleId));
        const matched = ruleRows.find((r) => r.id === action.ruleId);
        applied.push({ type: action.type, summary: `Will flag emails matching "${matched?.pattern}" again` });
      }
    } catch (e) {
      console.error("[digest reply] failed to apply action:", action, e);
    }
  }

  await db.insert(digestReplies).values({
    digestDate: today,
    text,
    actionsApplied: JSON.stringify(applied),
    createdBy: email,
    createdAt: now,
  });

  return NextResponse.json({
    ok: true,
    applied,
    note: applied.length === 0 ? "Saved — nothing specific to set up from that." : undefined,
  });
}
