import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, ensureDb, schema } from "@/db";

const { laborRateGroups, laborRateCatalog } = schema;

/**
 * Labor-rate GROUP CRUD (assistant-owned; DB only). A group (usually a project)
 * prepends its name to each of its rates on push ("Berger Bunkhouse - Regular
 * Pay"). The GLOBAL group is virtual (group_id 0, no prefix) and is NOT stored
 * here — the client always renders it. Office/admin-gated by middleware.
 */

export async function GET() {
  await ensureDb();
  const groups = await db
    .select()
    .from(laborRateGroups)
    .orderBy(asc(laborRateGroups.sortOrder), asc(laborRateGroups.name));
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const now = new Date().toISOString();
  try {
    const [group] = await db
      .insert(laborRateGroups)
      .values({ name, sortOrder: Number(body.sortOrder) || 0, createdAt: now, updatedAt: now })
      .returning();
    return NextResponse.json({ group });
  } catch {
    return NextResponse.json({ error: `A group named "${name}" already exists.` }, { status: 409 });
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
  if (body.sortOrder !== undefined) set.sortOrder = Number(body.sortOrder) || 0;
  try {
    const [group] = await db
      .update(laborRateGroups)
      .set(set)
      .where(eq(laborRateGroups.id, id))
      .returning();
    if (!group) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ group });
  } catch {
    return NextResponse.json({ error: "That name is already used by another group." }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest) {
  await ensureDb();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  // Deleting a group removes its catalog rate DEFINITIONS (employees keep any JT
  // pay types already applied — those are copies).
  await db.delete(laborRateCatalog).where(eq(laborRateCatalog.groupId, id));
  await db.delete(laborRateGroups).where(eq(laborRateGroups.id, id));
  return NextResponse.json({ ok: true });
}
