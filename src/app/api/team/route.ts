import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { allowedUsers } from "@/db/schema";
import { auth, envAllowed } from "@/auth";

// GET — the founder emails (env, read-only) + DB-managed members + who I am.
export async function GET() {
  await ensureDb();
  const members = await db.select().from(allowedUsers);
  const session = await auth();
  return NextResponse.json({ envAdmins: envAllowed(), members, me: session?.user?.email ?? null });
}

// POST { email } — add a teammate.
export async function POST(req: NextRequest) {
  const session = await auth();
  const body = await req.json().catch(() => ({}));
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  await ensureDb();
  await db
    .insert(allowedUsers)
    .values({ email, addedBy: session?.user?.email ?? "", createdAt: new Date().toISOString() })
    .onConflictDoNothing();
  const members = await db.select().from(allowedUsers);
  return NextResponse.json({ members });
}

// DELETE ?email= — remove a teammate (env founders can't be removed here).
export async function DELETE(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await ensureDb();
  await db.delete(allowedUsers).where(eq(allowedUsers.email, email));
  const members = await db.select().from(allowedUsers);
  return NextResponse.json({ members });
}
