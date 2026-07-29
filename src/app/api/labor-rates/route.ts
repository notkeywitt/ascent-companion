import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, ensureDb, schema } from "@/db";

const { laborRateCatalog } = schema;

/**
 * Labor-rate CATALOG CRUD (assistant-owned; DB only — no JobTread writes here).
 * The catalog is the list of named per-project rates the /labor-rates page
 * applies to employees. Office/admin-gated by middleware (see lib/views).
 * `name` is the SHORT rate name (e.g. "Regular Pay"); `groupId` (0 = Global)
 * decides the prefix on push. Unique on (group_id, name).
 */

/** Parse a money-ish input to a canonical non-negative numeric string, or null. */
function normRate(v: unknown): string | null {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
}

export async function GET() {
  await ensureDb();
  const rates = await db
    .select()
    .from(laborRateCatalog)
    .orderBy(asc(laborRateCatalog.sortOrder), asc(laborRateCatalog.name));
  return NextResponse.json({ rates });
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const hourlyRate = normRate(body.hourlyRate);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (hourlyRate == null)
    return NextResponse.json({ error: "a valid hourlyRate is required" }, { status: 400 });
  const groupId = Number(body.groupId) || 0;
  const now = new Date().toISOString();
  try {
    const [rate] = await db
      .insert(laborRateCatalog)
      .values({ name, groupId, hourlyRate, sortOrder: Number(body.sortOrder) || 0, createdAt: now, updatedAt: now })
      .returning();
    return NextResponse.json({ rate });
  } catch {
    return NextResponse.json({ error: `A rate named "${name}" already exists in this group.` }, { status: 409 });
  }
}

export async function PATCH(req: NextRequest) {
  await ensureDb();
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    set.name = n;
  }
  if (body.hourlyRate !== undefined) {
    const r = normRate(body.hourlyRate);
    if (r == null) return NextResponse.json({ error: "invalid hourlyRate" }, { status: 400 });
    set.hourlyRate = r;
  }
  if (body.groupId !== undefined) set.groupId = Number(body.groupId) || 0;
  if (body.sortOrder !== undefined) set.sortOrder = Number(body.sortOrder) || 0;
  try {
    const [rate] = await db
      .update(laborRateCatalog)
      .set(set)
      .where(eq(laborRateCatalog.id, id))
      .returning();
    if (!rate) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ rate });
  } catch {
    return NextResponse.json({ error: "That name is already used by another rate." }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest) {
  await ensureDb();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await db.delete(laborRateCatalog).where(eq(laborRateCatalog.id, id));
  return NextResponse.json({ ok: true });
}
