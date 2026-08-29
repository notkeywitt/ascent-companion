/**
 * Role preview — letting an admin see the app as each role.
 *
 * Pure constants + helpers only (no DB/React/next imports), so this is safe to
 * import from the server layout, the admin page (client), and the preview
 * banner (client) alike. The mechanism is a single cookie carrying the role an
 * admin is currently viewing the app AS; the server layout reads it (only ever
 * honoring it for a real admin) and hands that role's view set to the nav, so
 * the launcher, tabs and gates all render as that role would see them.
 *
 * Preview only ever NARROWS what the launcher shows — it never grants access
 * the signed-in user doesn't already have (middleware still runs on the real
 * session), so it's a safe, read-only lens, not an escalation path.
 */
import { ROLES, type Role } from "@/lib/views";
export type { Role } from "@/lib/views";

/** Cookie carrying the role an admin is previewing the app as. */
export const PREVIEW_COOKIE = "ascent-preview-role";

/** Human labels for each role, shared by the admin editor and the banner. */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  office: "Office",
  lead: "Lead",
  field: "Field",
};

/** A cookie value → a valid Role, or null if it isn't one. */
export function parsePreviewRole(value: string | undefined | null): Role | null {
  return value && (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}
