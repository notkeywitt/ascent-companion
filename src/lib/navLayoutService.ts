/**
 * Server side of the editable home launcher — the DB half of navLayout.ts.
 *
 * Kept SEPARATE from navLayout.ts so that module stays pure and importable from
 * client components; everything here touches the DB and is server-only (mirrors
 * copyService.ts sitting beside copy.ts).
 *
 * Failure model matches the registry's promise: if the DB is empty, missing, or
 * throws, `loadNavLayout` returns null and the launcher renders the shipped
 * AREAS default. A custom launcher is never a reason for the home page to fail
 * to render, so the read is deliberately swallowed rather than propagated.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { navLayout } from "@/db/schema";
import { sanitizeLayout, type NavLayout } from "@/lib/navLayout";

export const HOME_LAYOUT_ID = "home";

/**
 * The saved admin launcher, or null when there is no valid override (so the
 * caller falls back to the shipped AREAS default). A malformed stored blob is
 * treated as absent — `sanitizeLayout` returns null — rather than rendered.
 */
export async function loadNavLayout(): Promise<NavLayout | null> {
  try {
    const rows = await db
      .select()
      .from(navLayout)
      .where(eq(navLayout.id, HOME_LAYOUT_ID))
      .limit(1);
    const raw = rows[0]?.value;
    if (!raw) return null;
    return sanitizeLayout(JSON.parse(raw));
  } catch {
    // An unreachable DB (or bad JSON) must not blank the launcher.
    return null;
  }
}
