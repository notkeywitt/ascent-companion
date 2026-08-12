import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { notices, noticeReads } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { ROLES } from "@/lib/views";

/**
 * Admin CRUD for notices (the authoring side of Admin → Notices). Reads and
 * writes are admin-only — same gate as /api/team — so a non-admin can't push a
 * popup to everyone by calling the route directly. These are companion-DB writes,
 * not JobTread writes, so they're independent of the Pave write gates.
 */

const TONES = ["info", "warning", "success"] as const;
const AUDIENCE_TYPES = ["all", "role", "user"] as const;

async function requireAdmin() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const isAdmin = session?.user?.role === "admin" || envAllowed().includes(email);
  return { isAdmin, email };
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

/** Validate audience and coerce its value; returns null on a bad combination. */
function normalizeAudience(
  type: unknown,
  value: unknown,
): { audienceType: string; audienceValue: string } | null {
  if (!AUDIENCE_TYPES.includes(type as (typeof AUDIENCE_TYPES)[number])) return null;
  if (type === "all") return { audienceType: "all", audienceValue: "" };
  const v = String(value ?? "").trim();
  if (type === "role") {
    if (!ROLES.includes(v as (typeof ROLES)[number])) return null;
    return { audienceType: "role", audienceValue: v };
  }
  // user
  if (!v.includes("@")) return null;
  return { audienceType: "user", audienceValue: v.toLowerCase() };
}

/** All notices, newest first, each with a count of who's acknowledged it. */
async function listNotices() {
  const rows = await db.select().from(notices).orderBy(desc(notices.id));
  const counts = await db
    .select({ noticeId: noticeReads.noticeId, n: sql<number>`count(*)` })
    .from(noticeReads)
    .groupBy(noticeReads.noticeId);
  const readCount = new Map(counts.map((c) => [c.noticeId, Number(c.n)]));
  return rows.map((r) => ({ ...r, readCount: readCount.get(r.id) ?? 0 }));
}

export async function GET() {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  await ensureDb();
  return NextResponse.json({ notices: await listNotices() });
}

export async function POST(req: NextRequest) {
  const { isAdmin, email } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));

  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const tone = TONES.includes(body.tone) ? body.tone : "info";
  const audience = normalizeAudience(body.audienceType ?? "all", body.audienceValue);
  if (!audience) return NextResponse.json({ error: "invalid audience" }, { status: 400 });

  await ensureDb();
  const now = new Date().toISOString();
  await db.insert(notices).values({
    title,
    body: String(body.body ?? "").trim(),
    tone,
    audienceType: audience.audienceType,
    audienceValue: audience.audienceValue,
    active: body.active === false ? false : true,
    createdBy: email,
    createdAt: now,
    updatedAt: now,
  });
  return NextResponse.json({ notices: await listNotices() }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const set: Partial<typeof notices.$inferInsert> = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) return NextResponse.json({ error: "title can't be empty" }, { status: 400 });
    set.title = title;
  }
  if (body.body !== undefined) set.body = String(body.body).trim();
  if (body.tone !== undefined) {
    if (!TONES.includes(body.tone)) return NextResponse.json({ error: "invalid tone" }, { status: 400 });
    set.tone = body.tone;
  }
  if (body.active !== undefined) set.active = Boolean(body.active);
  if (body.audienceType !== undefined) {
    const audience = normalizeAudience(body.audienceType, body.audienceValue);
    if (!audience) return NextResponse.json({ error: "invalid audience" }, { status: 400 });
    set.audienceType = audience.audienceType;
    set.audienceValue = audience.audienceValue;
  }
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  set.updatedAt = new Date().toISOString();

  await ensureDb();
  await db.update(notices).set(set).where(eq(notices.id, id));
  return NextResponse.json({ notices: await listNotices() });
}

export async function DELETE(req: NextRequest) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await ensureDb();
  await db.delete(noticeReads).where(eq(noticeReads.noticeId, id));
  await db.delete(notices).where(eq(notices.id, id));
  return NextResponse.json({ notices: await listNotices() });
}
