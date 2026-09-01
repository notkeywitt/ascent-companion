import { NextRequest, NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { codingDrafts } from "@/db/schema";
import { DRAFT_TTL_DAYS, type CodingDraft } from "@/lib/codingDraft";

/**
 * The cross-device BACKUP for unsynced Tracking Sheets coding.
 *
 * This is NOT a JobTread write — it stores the office's staged, not-yet-synced
 * decision in the companion DB so it can be picked up on another device, or
 * after a browser is cleared. Nothing here touches the live org, so it is
 * independent of COMPANION_WRITES_ENABLED, exactly like /api/bill-reviewed.
 *
 * The browser's localStorage is the PRIMARY copy (written on every change);
 * this arrives on a debounce and can be a couple of seconds behind. See
 * src/lib/codingDraft.ts for the two-layer model and why staged work is
 * deliberately not auto-synced to JobTread.
 *
 * Scoped to the signed-in user, always from the session and never the body: a
 * draft is somebody's unfinished decision, and two people coding the same job
 * must not overwrite each other.
 *
 *   GET    ?key=<scope>   → { draft }        · ?all=1 → { drafts }
 *   POST   { key, draft } → { ok: true }
 *   DELETE ?key=<scope>   → { ok: true }
 */

async function emailOf(): Promise<string> {
  const session = await auth();
  return (session?.user?.email ?? "").trim().toLowerCase();
}

/** Drop this user's expired rows. Cheap, and it keeps the table from creeping. */
async function sweep(email: string) {
  const cutoff = new Date(Date.now() - DRAFT_TTL_DAYS * 86_400_000).toISOString();
  await db
    .delete(codingDrafts)
    .where(and(eq(codingDrafts.email, email), lt(codingDrafts.updatedAt, cutoff)));
}

function parsePayload(raw: string): CodingDraft | null {
  try {
    const d = JSON.parse(raw) as CodingDraft;
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const email = await emailOf();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
  const all = req.nextUrl.searchParams.get("all") === "1";
  if (!key && !all) return NextResponse.json({ error: "key is required" }, { status: 400 });

  try {
    await ensureDb();
    await sweep(email);
    if (all) {
      const rows = await db.select().from(codingDrafts).where(eq(codingDrafts.email, email));
      const drafts = rows
        .map((r) => parsePayload(r.payload))
        .filter((d): d is CodingDraft => d !== null)
        .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
      return NextResponse.json({ drafts });
    }
    const rows = await db
      .select()
      .from(codingDrafts)
      .where(and(eq(codingDrafts.email, email), eq(codingDrafts.key, key)))
      .limit(1);
    return NextResponse.json({ draft: rows[0] ? parsePayload(rows[0].payload) : null });
  } catch (e) {
    // A draft backup must never be the thing that breaks a page: the browser's
    // own copy is the one that matters, so an unreachable DB reads as "none".
    return NextResponse.json(
      { draft: null, drafts: [], error: e instanceof Error ? e.message : "Unknown error" },
      { status: 200 },
    );
  }
}

export async function POST(req: NextRequest) {
  const email = await emailOf();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { key?: string; draft?: CodingDraft };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = (body.key ?? "").trim();
  const draft = body.draft;
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  if (!draft || typeof draft !== "object")
    return NextResponse.json({ error: "draft is required" }, { status: 400 });

  const payload = JSON.stringify({ ...draft, key });
  // A draft is small (a few dozen ids); anything this size is a bug or an abuse,
  // and storing it would only fill the table.
  if (payload.length > 256_000)
    return NextResponse.json({ error: "Draft too large" }, { status: 413 });

  try {
    await ensureDb();
    const updatedAt = new Date().toISOString();
    await db
      .insert(codingDrafts)
      .values({ email, key, payload, updatedAt })
      .onConflictDoUpdate({
        target: [codingDrafts.email, codingDrafts.key],
        set: { payload, updatedAt },
      });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const email = await emailOf();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

  try {
    await ensureDb();
    await db
      .delete(codingDrafts)
      .where(and(eq(codingDrafts.email, email), eq(codingDrafts.key, key)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
