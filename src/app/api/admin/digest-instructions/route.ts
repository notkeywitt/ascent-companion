import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { digestInstructions } from "@/db/schema";
import { auth, envAllowed } from "@/auth";

/**
 * /admin's Digest tab — manage the Daily Digest's STANDING INSTRUCTIONS (the
 * owner's durable "how to write the brief" preferences). The reply box on the
 * home screen can add and drop these conversationally; this route is the
 * see-everything-and-remove surface for an admin, and the place to add one
 * without going through the reply parser.
 *
 * Injected into the summary prompt on every run — see
 * src/lib/digest/instructions.ts and summarizeDigestWithClaude in
 * src/lib/digest/claude.ts. Deactivated (not deleted) on removal, same as the
 * reply box, so "why did the digest stop mentioning X" stays answerable.
 *
 * Same admin gate as every other /api/admin/* route (duplicated per-route —
 * this codebase's existing convention).
 */
async function requireAdminEmail(): Promise<string | null> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (session?.user?.role === "admin" || envAllowed().includes(email)) return email;
  return null;
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

/** Active instructions, newest first — the shape the panel renders. */
async function activeInstructions() {
  await ensureDb();
  return db
    .select({ id: digestInstructions.id, text: digestInstructions.text, createdBy: digestInstructions.createdBy })
    .from(digestInstructions)
    .where(eq(digestInstructions.active, true))
    .orderBy(desc(digestInstructions.createdAt));
}

export async function GET() {
  if (!(await requireAdminEmail())) return FORBIDDEN;
  return NextResponse.json({ instructions: await activeInstructions() });
}

// POST { text } — add a standing instruction.
export async function POST(req: NextRequest) {
  const email = await requireAdminEmail();
  if (!email) return FORBIDDEN;

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "An instruction can't be empty." }, { status: 400 });

  await ensureDb();
  const now = new Date().toISOString();
  await db.insert(digestInstructions).values({ text, active: true, createdBy: email, createdAt: now, updatedAt: now });

  return NextResponse.json({ instructions: await activeInstructions() });
}

// DELETE ?id=... — deactivate one standing instruction (kept, not deleted).
export async function DELETE(req: NextRequest) {
  if (!(await requireAdminEmail())) return FORBIDDEN;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  await ensureDb();
  await db
    .update(digestInstructions)
    .set({ active: false, updatedAt: new Date().toISOString() })
    .where(eq(digestInstructions.id, id));

  return NextResponse.json({ instructions: await activeInstructions() });
}
