import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { allowedUsers } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { ALL_VIEW_IDS, ROLE_VIEWS, ROLES, VIEWS, type Role } from "@/lib/views";

function parseIds(s: string | null | undefined): string[] {
  try {
    const a = JSON.parse(s ?? "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Keep only known view ids (drops stale/garbage). */
function cleanIds(v: unknown): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && ALL_VIEW_IDS.includes(x)))]
    : [];
}

function asRole(v: unknown): Role | null {
  return v === "admin" || v === "office" || v === "lead" || v === "field" ? v : null;
}

type Member = {
  email: string;
  addedBy: string;
  createdAt: string;
  role: string;
  viewsAllow: string[];
  viewsDeny: string[];
};

function serialize(rows: (typeof allowedUsers.$inferSelect)[]): Member[] {
  return rows.map((r) => ({
    email: r.email,
    addedBy: r.addedBy,
    createdAt: r.createdAt,
    role: r.role,
    viewsAllow: parseIds(r.viewsAllow),
    viewsDeny: parseIds(r.viewsDeny),
  }));
}

/** Only admins (env founders or role:"admin") may read/manage team access. */
async function requireAdmin() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const isAdmin = session?.user?.role === "admin" || envAllowed().includes(email);
  return { isAdmin, email };
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

// GET — founders (env, read-only) + DB members (with role/overrides) + who I am,
// plus the views catalog + role base sets so the admin UI can render the editor.
export async function GET() {
  const { isAdmin, email } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  await ensureDb();
  const members = serialize(await db.select().from(allowedUsers));
  return NextResponse.json({
    envAdmins: envAllowed(),
    members,
    me: email || null,
    catalog: VIEWS.map((v) => ({ id: v.id, label: v.label, group: v.group })),
    roleViews: ROLE_VIEWS,
    roles: ROLES,
  });
}

// POST { email, role? } — add a teammate (defaults to the restricted "field" role).
export async function POST(req: NextRequest) {
  const { isAdmin, email: me } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  const role = asRole(body.role) ?? "field";
  await ensureDb();
  await db
    .insert(allowedUsers)
    .values({ email, addedBy: me, createdAt: new Date().toISOString(), role, viewsAllow: "[]", viewsDeny: "[]" })
    .onConflictDoNothing();
  return NextResponse.json({ members: serialize(await db.select().from(allowedUsers)) });
}

// PATCH { email, role?, viewsAllow?, viewsDeny? } — update a member's access.
export async function PATCH(req: NextRequest) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const set: Partial<typeof allowedUsers.$inferInsert> = {};
  if (body.role !== undefined) {
    const role = asRole(body.role);
    if (!role) return NextResponse.json({ error: "invalid role" }, { status: 400 });
    set.role = role;
  }
  if (body.viewsAllow !== undefined) set.viewsAllow = JSON.stringify(cleanIds(body.viewsAllow));
  if (body.viewsDeny !== undefined) set.viewsDeny = JSON.stringify(cleanIds(body.viewsDeny));
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  await ensureDb();
  await db.update(allowedUsers).set(set).where(eq(allowedUsers.email, email));
  return NextResponse.json({ members: serialize(await db.select().from(allowedUsers)) });
}

// DELETE ?email= — remove a teammate (env founders can't be removed here).
export async function DELETE(req: NextRequest) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await ensureDb();
  await db.delete(allowedUsers).where(eq(allowedUsers.email, email));
  return NextResponse.json({ members: serialize(await db.select().from(allowedUsers)) });
}
