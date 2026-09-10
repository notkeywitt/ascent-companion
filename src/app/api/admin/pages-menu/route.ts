/**
 * Admin → All Pages menu: read and edit the ORDER and GROUPING of the menu that
 * lists every page in the app (see src/lib/pagesMenu.ts). Driven by the menu's
 * own Edit mode (src/components/PagesMenuEditor.tsx).
 *
 * GET    → { layout, isCustom, catalog }
 *          `layout` is what renders today (the saved override, or the shipped
 *          grouping); `catalog` is every page, so the editor can name the rows
 *          it is arranging.
 * PUT   { layout } → replace the whole menu with one validated document.
 * DELETE → drop the override, reverting to the shipped grouping.
 *
 * Admin-only, same requireAdmin() shape as /api/admin/home-layout. Companion-
 * owned UI state in the companion DB — it touches neither JobTread nor the
 * Sheet, so it sits outside the JobTread write gates. Nothing here can race the
 * mirror.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { navLayout } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { PAGE_CATALOG, defaultPagesMenu, sanitizePagesMenu } from "@/lib/pagesMenu";
import { PAGES_MENU_ID, loadPagesMenu } from "@/lib/navLayoutService";

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  return session?.user?.role === "admin" || envAllowed().includes(email);
}

async function currentEmail(): Promise<string> {
  const session = await auth();
  return (session?.user?.email ?? "").toLowerCase();
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

export async function GET() {
  if (!(await requireAdmin())) return FORBIDDEN;
  const custom = await loadPagesMenu();
  return NextResponse.json({
    layout: custom ?? defaultPagesMenu(),
    isCustom: custom !== null,
    // Flattened: the editor arranges pages across groups, so it needs every
    // page's wording regardless of which group it currently sits in.
    catalog: PAGE_CATALOG.flatMap((g) => g.pages),
  });
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin())) return FORBIDDEN;

  let body: { layout?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const layout = sanitizePagesMenu(body.layout);
  if (!layout) {
    return NextResponse.json(
      { error: "That menu is empty or invalid. Keep at least one group." },
      { status: 400 },
    );
  }

  await ensureDb();
  const now = new Date().toISOString();
  const email = await currentEmail();
  await db
    .insert(navLayout)
    .values({ id: PAGES_MENU_ID, value: JSON.stringify(layout), updatedAt: now, updatedBy: email })
    .onConflictDoUpdate({
      target: navLayout.id,
      set: { value: JSON.stringify(layout), updatedAt: now, updatedBy: email },
    });

  return NextResponse.json({ ok: true, layout, isCustom: true });
}

export async function DELETE() {
  if (!(await requireAdmin())) return FORBIDDEN;
  await ensureDb();
  await db.delete(navLayout).where(eq(navLayout.id, PAGES_MENU_ID));
  return NextResponse.json({ ok: true, layout: defaultPagesMenu(), isCustom: false });
}
