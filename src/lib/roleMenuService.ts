/**
 * Server-only read of the per-role side-menu edits (`role_menu`). Kept apart
 * from lib/workspaces.ts so that module stays pure and importable from client
 * components.
 *
 * Same failure model as loadCopyOverrides: an empty, missing or unreachable
 * table gives the shipped menu, so a menu edit is never a reason for a page to
 * fail to render.
 */
import { db, ensureDb } from "@/db";
import { roleMenu } from "@/db/schema";
import { NO_MENU_CHANGE, cleanMenuKeys, type RoleMenu } from "@/lib/workspaces";
import type { Role } from "@/lib/views";

function parseKeys(s: string | null | undefined): string[] {
  try {
    return cleanMenuKeys(JSON.parse(s ?? "[]"));
  } catch {
    return [];
  }
}

/** Every role's edit, keyed by role. A role with no row is absent. */
export async function loadRoleMenus(): Promise<Partial<Record<Role, RoleMenu>>> {
  try {
    await ensureDb();
    const rows = await db.select().from(roleMenu);
    const out: Partial<Record<Role, RoleMenu>> = {};
    for (const r of rows) out[r.role as Role] = { add: parseKeys(r.itemsAdd), hide: parseKeys(r.itemsHide) };
    return out;
  } catch {
    return {};
  }
}

/** One role's edit, or no change. NOT cached: one small table read per render. */
export async function loadRoleMenu(role: Role): Promise<RoleMenu> {
  return (await loadRoleMenus())[role] ?? NO_MENU_CHANGE;
}
