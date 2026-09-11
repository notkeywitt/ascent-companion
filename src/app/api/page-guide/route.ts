/**
 * The page guide behind the help overlay (see src/components/PageGuide.tsx).
 *
 * GET  ?path=/bill/*            → { topics }  — any signed-in reader.
 * PUT  { path, topics }         → replace that page's guide. ADMIN ONLY.
 *                                 An empty list deletes the row.
 *
 * Companion-owned help text in the companion DB: it touches neither JobTread
 * nor the Sheet, so it sits outside the JobTread write gates, same as
 * /api/admin/copy.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { pageGuides } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { guidePathKey, normalizeTopics, parseGuide } from "@/lib/pageGuide";

export async function GET(req: NextRequest) {
  const path = guidePathKey(req.nextUrl.searchParams.get("path") ?? "/");
  try {
    await ensureDb();
    const rows = await db.select().from(pageGuides).where(eq(pageGuides.path, path)).limit(1);
    return NextResponse.json({ path, topics: rows[0] ? parseGuide(rows[0].value) : [] });
  } catch {
    // Help is never a reason for a page to look broken.
    return NextResponse.json({ path, topics: [] });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (session?.user?.role !== "admin" && !envAllowed().includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { path?: unknown; topics?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const path = guidePathKey(typeof body.path === "string" ? body.path : "/");
  const topics = normalizeTopics(body.topics);

  await ensureDb();
  if (topics.length === 0) {
    await db.delete(pageGuides).where(eq(pageGuides.path, path));
    return NextResponse.json({ ok: true, path, topics });
  }

  const row = {
    path,
    value: JSON.stringify(topics),
    updatedAt: new Date().toISOString(),
    updatedBy: email,
  };
  await db
    .insert(pageGuides)
    .values(row)
    .onConflictDoUpdate({
      target: pageGuides.path,
      set: { value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy },
    });
  return NextResponse.json({ ok: true, path, topics });
}
