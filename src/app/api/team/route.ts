import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { allowedUsers } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { requireAuth } from "@/lib/require-auth";

/** Mutations are founder-only: a Google session whose email is in ALLOWED_EMAILS.
 *  A shared-password session must not be able to edit the allowlist. */
async function requireFounder() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  return email && envAllowed().includes(email) ? email : null;
}

// GET — the founder emails (env, read-only) + DB-managed members + who I am.
export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureDb();
  const members = await db.select().from(allowedUsers);
  const session = await auth();
  return NextResponse.json({ envAdmins: envAllowed(), members, me: session?.user?.email ?? null });
}

// POST { email } — add a teammate.
export async function POST(req: NextRequest) {
  const founder = await requireFounder();
  if (!founder) {
    return NextResponse.json({ error: "Only a signed-in founder can edit the team." }, { status: 403 });
  }
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
  if (!(await requireFounder())) {
    return NextResponse.json({ error: "Only a signed-in founder can edit the team." }, { status: 403 });
  }
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await ensureDb();
  await db.delete(allowedUsers).where(eq(allowedUsers.email, email));
  const members = await db.select().from(allowedUsers);
  return NextResponse.json({ members });
}
