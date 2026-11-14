import { NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { digestTodos } from "@/db/schema";
import { todoIdFromKey } from "@/lib/digest/dismissals";
import { dismiss, get, isHidden, list, restore, snooze } from "@/lib/findings";
import { macCheckStatus, refreshSources } from "@/lib/findingSources";
import { readDispositions } from "@/lib/invoiceReview/dispositions";
import { liftRuling, recordRuling } from "@/lib/invoiceReview/rulings";
import type { FindingDisposition, FindingKind } from "@/lib/invoiceReview/types";

/**
 * The inbox behind /attention. Gated by the `attention` view (lib/views.ts).
 *
 * GET  → { rows, macCheck }. Every open finding the reader may see, each with
 *        `hidden` (snoozed or dismissed) and, for invoice review, the Mac
 *        check's `verdict`. Pull sources are refreshed first.
 * POST { id, action: "snooze" | "dismiss" | "restore" } → { ok }.
 *        Writes the companion database only. Never JobTread.
 *
 * An invoice review finding keeps its dismissal in `invoice_review_rulings`,
 * so the review page and its accuracy figures agree with the inbox: dismiss
 * records a ruling on that one finding, restore lifts it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SNOOZE_MS = 24 * 60 * 60 * 1000;
const DISMISS_REASON = "Dismissed in Needs attention";

export async function GET() {
  const email = ((await auth())?.user?.email ?? "").toLowerCase();
  await refreshSources();
  const rows = await list({ reader: email, hidden: true });

  // The Mac check's verdicts join on (month, key): scope + key here.
  const months = [...new Set(rows.filter((r) => r.source === "invoice-review").map((r) => r.scope))];
  const verdicts = new Map<string, Map<string, FindingDisposition>>(
    await Promise.all(months.map(async (ym) => [ym, await readDispositions(ym)] as const)),
  );

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      hidden: isHidden(r),
      verdict: r.source === "invoice-review" ? (verdicts.get(r.scope)?.get(r.key) ?? null) : null,
    })),
    macCheck: await macCheckStatus(),
  });
}

export async function POST(req: NextRequest) {
  const email = ((await auth())?.user?.email ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const row = await get(Number(body.id));
  // A per-user row belongs to its reader alone.
  if (!row || (row.scope.includes("@") && row.scope !== email)) {
    return NextResponse.json({ error: "No such finding" }, { status: 404 });
  }
  const review = row.source === "invoice-review";

  if (body.action === "snooze") {
    await snooze(row.id, new Date(Date.now() + SNOOZE_MS).toISOString());
  } else if (body.action === "dismiss") {
    if (review) {
      await recordRuling({
        key: row.key,
        kind: row.kind as FindingKind,
        jobId: row.subject,
        scope: "finding",
        reason: DISMISS_REASON,
        by: email,
      });
    }
    await dismiss(row.id, email, DISMISS_REASON);
    // The office's own reminder lives only in digest_todos: dismissing it
    // there means done, the same as the digest's Dismiss button.
    const todoId = row.source === "digest" ? todoIdFromKey(row.key) : null;
    if (todoId !== null) {
      const now = new Date().toISOString();
      await db.update(digestTodos).set({ status: "done", completedAt: now, updatedAt: now }).where(eq(digestTodos.id, todoId));
    }
  } else if (body.action === "restore") {
    // Lifts a ruling on this one finding. A wider ruling (a whole job or
    // customer) is lifted on the review page; the next run dismisses again.
    if (review && row.dismissedBy) await liftRuling(row.key);
    await restore(row.id);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
