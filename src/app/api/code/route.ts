import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearJobCostCaches, updateLine } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { recordCoding } from "@/lib/usage";
import { openJournal } from "@/lib/financialJournal";
import type { RecodeEntry } from "@/lib/billLineMath";
import { db, ensureDb } from "@/db";
import { savedBills } from "@/db/schema";

interface Change {
  costItemId: string;
  name?: string;
  jobCostItemId?: string;
  quantity?: number;
  unitCost?: number;
  description?: string;
}

const hasEdit = (c: Change) =>
  c.costItemId &&
  (c.name !== undefined ||
    c.jobCostItemId !== undefined ||
    c.quantity !== undefined ||
    c.unitCost !== undefined);

/**
 * Phase B — save bill-line edits (coding / quantity / unitCost) to JobTread.
 * DISABLED BY DEFAULT: unless COMPANION_WRITES_ENABLED=true, this writes nothing
 * and returns a preview of what *would* change.
 */
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { changes?: Change[]; docId?: string; codingLog?: RecodeEntry[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const changes = (body.changes ?? []).filter(hasEdit);
  if (changes.length === 0) {
    return NextResponse.json({ error: "No line edits provided" }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
      changes,
    });
  }

  // Attribute this coding save to the signed-in user (from the session, never
  // the body) — used for the savedBy marker and the Admin → Activity log below.
  const session = await auth();
  const email = (session?.user?.email ?? "").trim().toLowerCase();

  const cfg = getPaveConfig();
  const results: { costItemId: string; ok: boolean; error?: string }[] = [];
  // One journal for the whole save, so every line edited by this tap shares a
  // requestId and reads back as ONE action.
  //
  // `before` here is the browser's own diff (`codingLog`), so `beforeSource` is
  // "client" — useful, not evidence. Reading each line's prior value live would
  // be one extra JobTread round trip PER LINE on a save that routinely carries
  // twenty, which is why the honest label is preferred over the slow read. The
  // single-record routes (tax, status, issue date, delete) all read live.
  const j = await openJournal("/api/code", { email, role: (session?.user as { role?: string })?.role ?? "" });
  const priorCode = new Map<string, string>();
  for (const entry of body.codingLog ?? []) {
    if (entry?.line) priorCode.set(String(entry.line), String(entry.from ?? ""));
  }
  for (const c of changes) {
    const line = {
      name: c.name,
      jobCostItemId: c.jobCostItemId,
      quantity: c.quantity,
      unitCost: c.unitCost,
      description: c.description,
    };
    const extended =
      typeof c.quantity === "number" && typeof c.unitCost === "number"
        ? Math.round(c.quantity * c.unitCost * 100) / 100
        : null;
    try {
      await updateLine(cfg, c.costItemId, line);
      results.push({ costItemId: c.costItemId, ok: true });
      await j.record([
        {
          action: "line.update",
          entity: "line",
          entityId: c.costItemId,
          docId: (body.docId ?? "").trim(),
          field: "",
          before: c.name ? priorCode.get(c.name) : undefined,
          after: line,
          beforeSource: c.name && priorCode.has(c.name) ? "client" : "none",
          amount: extended,
        },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      results.push({ costItemId: c.costItemId, ok: false, error: message });
      await j.record([
        {
          action: "line.update",
          entity: "line",
          entityId: c.costItemId,
          docId: (body.docId ?? "").trim(),
          after: line,
          beforeSource: "none",
          amount: extended,
          outcome: "error",
          error: message,
        },
      ]);
    }
  }

  // Re-coding or re-pricing a line on a non-draft bill moves cost between codes,
  // so the job's cached cost-to-complete is now stale.
  if (results.some((r) => r.ok)) clearJobCostCaches();

  // Mark this bill as "saved" (Save clicked + at least one line written) so the
  // coding queue can flag bills the office has already worked, and log the
  // coding change to the Admin → Activity feed. Both best-effort — a DB hiccup
  // here must never fail the save itself.
  if (body.docId && results.some((r) => r.ok)) {
    try {
      await ensureDb();
      const now = new Date().toISOString();
      await db
        .insert(savedBills)
        .values({ docId: body.docId, savedAt: now, savedBy: email })
        .onConflictDoUpdate({ target: savedBills.docId, set: { savedAt: now, savedBy: email } });
    } catch {
      /* indicator is best-effort */
    }
    // Append-only activity log (never blocks the response — recordCoding
    // swallows its own errors). codingLog is the client's diff of which lines
    // actually changed cost code (the whole-bill push can't reveal that server-
    // side); recordCoding sanitizes it before storing.
    void recordCoding(email, body.docId, body.codingLog);
  }

  return NextResponse.json({ previewed: false, wrote: true, results });
}
