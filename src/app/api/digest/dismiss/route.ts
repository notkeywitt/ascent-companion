import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { digestTodos } from "@/db/schema";
import { todoIdFromKey } from "@/lib/digest/dismissals";
import { liftDismissal, saveDismissal } from "@/lib/digest/store";

/**
 * POST /api/digest/dismiss — "this one is handled, stop showing it to me."
 *
 * The Dismiss button on a To-Do or Follow-ups item. Writes one row in
 * `digest_dismissals` keyed by the item's stable identity (`dismissalKey` in
 * src/lib/digest/dismissals.ts, computed identically in the browser and here),
 * which both GET /api/digest and the next run filter with. Pass `undo: true` to
 * lift a dismissal — the row is deactivated, never deleted.
 *
 * WHAT IT DOES NOT DO. It does not close a JobTread to-do, and it does not
 * reply to, label, archive or read a Gmail thread. A dismissal is this app's
 * opinion about what to SHOW; the source systems stay untouched, which is what
 * keeps the digest safe to dismiss from freely.
 *
 * THE ONE EXCEPTION is the office's own reminders (`digest-todos`): those live
 * in this database and nowhere else, so dismissing one marks it done in
 * `digest_todos` — the same state a reply-box "that's handled" produces. Undo
 * reopens it.
 *
 * Session-gated, like the reply box.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const checkId = typeof body?.checkId === "string" ? body.checkId.trim() : "";
  const title = typeof body?.title === "string" ? body.title : "";
  const undo = body?.undo === true;
  if (!key || key.length > 400) {
    return NextResponse.json({ error: "Nothing to dismiss." }, { status: 400 });
  }

  try {
    await ensureDb();
    const now = new Date().toISOString();

    // The office's own reminder: resolve it at the source, not just on the card.
    const todoId = todoIdFromKey(key);
    if (todoId !== null) {
      await db
        .update(digestTodos)
        .set(
          undo
            ? { status: "open", completedAt: "", updatedAt: now }
            : { status: "done", completedAt: now, updatedAt: now },
        )
        .where(eq(digestTodos.id, todoId));
    }

    if (undo) {
      await liftDismissal(key);
    } else {
      await saveDismissal({ key, checkId, title, by: email });
    }
    return NextResponse.json({ ok: true, key, undone: undo });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
