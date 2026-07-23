import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { sunsetStatements } from "@/db/schema";

// PATCH /api/sunset-statements/:expId — mark a Sunset statement paid / unpaid.
// This is an owner action (normal session auth, no ingest secret). Paid state is
// companion-owned; re-listing a statement never resets it (see the GET route).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const expId = decodeURIComponent(id).trim();
  if (!expId) return NextResponse.json({ ok: false, error: "Bad id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const status = String(body.status ?? "").toLowerCase();
  if (status !== "paid" && status !== "unpaid") {
    return NextResponse.json({ ok: false, error: 'status must be "paid" or "unpaid".' }, { status: 400 });
  }

  let email = "";
  try {
    const session = await auth();
    email = session?.user?.email ?? "";
  } catch {
    /* session lookup is best-effort — paidBy is optional */
  }

  const now = new Date().toISOString();
  await ensureDb();
  const [row] = await db
    .update(sunsetStatements)
    .set({
      status,
      paidAt: status === "paid" ? now : "",
      paidBy: status === "paid" ? email : "",
      updatedAt: now,
    })
    .where(eq(sunsetStatements.expId, expId))
    .returning();

  if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, statement: row });
}
