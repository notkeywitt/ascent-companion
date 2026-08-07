import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/db";
import { roleAccess } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { ALL_VIEW_IDS, type Role } from "@/lib/views";

/** Keep only known view ids (drops stale/garbage). */
function cleanIds(v: unknown): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && ALL_VIEW_IDS.includes(x)))]
    : [];
}

function asEditableRole(v: unknown): Role | null {
  return v === "office" || v === "lead" || v === "field" ? v : null;
}

function parseIds(s: string | null | undefined): string[] {
  try {
    const a = JSON.parse(s ?? "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  return session?.user?.role === "admin" || envAllowed().includes(email);
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

async function currentOverrides() {
  await ensureDb();
  const rows = await db.select().from(roleAccess);
  const out: Record<string, { viewsAllow: string[]; viewsDeny: string[] }> = {};
  for (const r of rows) out[r.role] = { viewsAllow: parseIds(r.viewsAllow), viewsDeny: parseIds(r.viewsDeny) };
  return out;
}

// PATCH { role, viewsAllow?, viewsDeny? } — edit what a whole role sees by
// default (on top of the hardcoded ROLE_VIEWS in lib/views.ts). Every member
// with that role picks up the change the next time they sign in, same as a
// per-user override. "admin" can't be edited here — it always gets every
// view, so a bad edit here can never lock every admin out of the console that
// would fix it.
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));
  const role = asEditableRole(body.role);
  if (!role) {
    return NextResponse.json({ error: "role must be office, lead, or field" }, { status: 400 });
  }

  const existing = (await currentOverrides())[role] ?? { viewsAllow: [], viewsDeny: [] };
  const viewsAllow = body.viewsAllow !== undefined ? cleanIds(body.viewsAllow) : existing.viewsAllow;
  const viewsDeny = body.viewsDeny !== undefined ? cleanIds(body.viewsDeny) : existing.viewsDeny;

  await ensureDb();
  await db
    .insert(roleAccess)
    .values({ role, viewsAllow: JSON.stringify(viewsAllow), viewsDeny: JSON.stringify(viewsDeny), updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: roleAccess.role,
      set: { viewsAllow: JSON.stringify(viewsAllow), viewsDeny: JSON.stringify(viewsDeny), updatedAt: new Date().toISOString() },
    });

  return NextResponse.json({ roleOverrides: await currentOverrides() });
}
