/**
 * Server-only read of the skin an admin set for one person (`user_skins`,
 * /admin → Skins). layout.tsx calls it once per render and hands the answer to
 * the pre-paint script, which applies a NEW push before the first paint.
 *
 * Same failure model as loadRoleMenu: a missing or unreachable table gives
 * null (the device chooses), so a skin is never a reason for a page to fail.
 */
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { userSkins } from "@/db/schema";
import { isPalette } from "@/lib/palette";

/**
 * The admin's push as "<palette>@<updatedAt>", or null. The stamp lets each
 * device apply a push ONCE: after that the person may pick any skin, until an
 * admin sets one again (a new stamp).
 */
export async function loadUserSkin(email: string | null | undefined): Promise<string | null> {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return null;
  try {
    await ensureDb();
    const [row] = await db.select().from(userSkins).where(eq(userSkins.email, key));
    return row && isPalette(row.palette) ? `${row.palette}@${row.updatedAt}` : null;
  } catch {
    return null;
  }
}
