import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/db";
import { noticeReads } from "@/db/schema";
import { auth } from "@/auth";

/**
 * POST /api/notices/dismiss { id } — the reader acknowledges a notice. Writes the
 * (notice, email) read mark that keeps it out of the feed from now on; a repeat
 * dismiss is a harmless no-op. The email comes from the session, never the body.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await ensureDb();
  await db
    .insert(noticeReads)
    .values({ noticeId: id, email, readAt: new Date().toISOString() })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}
