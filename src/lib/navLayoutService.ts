/**
 * Server side of the two editable launcher documents — the DB half of
 * navLayout.ts (the admin home launcher) and pagesMenu.ts (the All Pages menu).
 * Both live in `nav_layout`, one row each, keyed by the ids below.
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
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { navLayout } from "@/db/schema";
import { sanitizeLayout, type NavLayout } from "@/lib/navLayout";
import { sanitizePagesMenu, type PagesMenuLayout } from "@/lib/pagesMenu";

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

/** The row holding the "All Pages" menu's order and grouping. */
export const PAGES_MENU_ID = "pages";

/**
 * The saved "All Pages" grouping, or null when there is no valid override (so
 * the caller renders the shipped grouping). Same failure model as above: an
 * unreachable DB or a malformed blob costs the customization, never the menu.
 */
export async function loadPagesMenu(): Promise<PagesMenuLayout | null> {
  try {
    const rows = await db
      .select()
      .from(navLayout)
      .where(eq(navLayout.id, PAGES_MENU_ID))
      .limit(1);
    const raw = rows[0]?.value;
    if (!raw) return null;
    return sanitizePagesMenu(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Both launcher documents in ONE query — what the root layout needs on every
 * render. Two `loadX()` calls would be two round trips to libSQL for two rows
 * of the same table, on every page in the app.
 */
export async function loadLaunchers(): Promise<{
  home: NavLayout | null;
  pages: PagesMenuLayout | null;
}> {
  try {
    const rows = await db
      .select()
      .from(navLayout)
      .where(inArray(navLayout.id, [HOME_LAYOUT_ID, PAGES_MENU_ID]));
    const raw = (id: string) => rows.find((r) => r.id === id)?.value ?? "";
    const parse = <T>(value: string, fn: (v: unknown) => T | null): T | null => {
      if (!value) return null;
      try {
        return fn(JSON.parse(value));
      } catch {
        return null;
      }
    };
    return {
      home: parse(raw(HOME_LAYOUT_ID), sanitizeLayout),
      pages: parse(raw(PAGES_MENU_ID), sanitizePagesMenu),
    };
  } catch {
    // An unreachable DB must not blank either launcher.
    return { home: null, pages: null };
  }
}
