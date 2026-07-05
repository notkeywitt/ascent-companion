import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { rfis } from "@/db/schema";

// PATCH /api/rfis/:id — update status / answer / assignee / dueDate / question.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rfiId = Number(id);
  if (!Number.isFinite(rfiId)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: Record<string, string> = { updatedAt: new Date().toISOString() };
  for (const field of ["status", "answer", "assignee", "dueDate", "question", "subject"]) {
    if (typeof body[field] === "string") patch[field] = body[field];
  }
  await ensureDb();
  const [row] = await db.update(rfis).set(patch).where(eq(rfis.id, rfiId)).returning();
  if (!row) return NextResponse.json({ error: "RFI not found" }, { status: 404 });
  return NextResponse.json({ rfi: row });
}
