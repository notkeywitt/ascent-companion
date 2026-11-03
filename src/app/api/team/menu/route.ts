import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/db";
import { roleMenu } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { ROLES, type Role } from "@/lib/views";
import { cleanMenuKeys } from "@/lib/workspaces";
import { loadRoleMenus } from "@/lib/roleMenuService";

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  return session?.user?.role === "admin" || envAllowed().includes(email);
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

// GET — every role's side-menu edit. A role with no edit is absent.
export async function GET() {
  if (!(await requireAdmin())) return FORBIDDEN;
  return NextResponse.json({ roleMenus: await loadRoleMenus() });
}

// PATCH { role, add, hide } — replace one role's side-menu edit. Empty lists
// put the role back on the shipped menu. Every role is editable, admin too:
// railFor keeps the Admin workspace on the admin menu whatever is stored.
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));
  const role = ROLES.includes(body.role) ? (body.role as Role) : null;
  if (!role) {
    return NextResponse.json({ error: `role must be one of ${ROLES.join(", ")}` }, { status: 400 });
  }
  const itemsAdd = JSON.stringify(cleanMenuKeys(body.add));
  const itemsHide = JSON.stringify(cleanMenuKeys(body.hide));
  const updatedAt = new Date().toISOString();

  await ensureDb();
  await db
    .insert(roleMenu)
    .values({ role, itemsAdd, itemsHide, updatedAt })
    .onConflictDoUpdate({ target: roleMenu.role, set: { itemsAdd, itemsHide, updatedAt } });

  return NextResponse.json({ roleMenus: await loadRoleMenus() });
}
