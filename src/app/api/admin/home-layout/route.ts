/**
 * Admin → Home layout: read and edit the admin home launcher — its menus, the
 * page links inside them, and buttons (see src/lib/navLayout.ts). Driven by the
 * home page's Edit mode (src/components/HomeLayoutEditor.tsx).
 *
 * GET    → { layout, isCustom, views }
 *          `layout` is what renders today (the saved override, or the shipped
 *          AREAS default); `views` is the catalog of gate ids the editor offers
 *          when pointing a link at a page.
 * PUT   { layout } → replace the whole launcher with one validated document.
 * DELETE → drop the override, reverting to the shipped launcher.
 *
 * Admin-only, same requireAdmin() shape as /api/admin/copy. This is companion-
 * owned UI state in the companion DB — it touches neither JobTread nor the
 * Sheet, so it is deliberately NOT behind the JobTread write gates. Nothing
 * here can race the mirror.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { navLayout } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { defaultLayout, sanitizeLayout } from "@/lib/navLayout";
import { HOME_LAYOUT_ID, loadNavLayout } from "@/lib/navLayoutService";
import { VIEWS } from "@/lib/views";

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

/** The gate ids the editor offers, each with its canonical route and a label. */
function viewCatalog() {
  return VIEWS.map((v) => ({ id: v.id, label: v.label, href: v.paths[0] ?? "" }));
}

export async function GET() {
  if (!(await requireAdmin())) return FORBIDDEN;
  const custom = await loadNavLayout();
  return NextResponse.json({
    layout: custom ?? defaultLayout(),
    isCustom: custom !== null,
    views: viewCatalog(),
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

  const layout = sanitizeLayout(body.layout);
  if (!layout) {
    return NextResponse.json(
      { error: "That layout is empty or invalid. Keep at least one menu." },
      { status: 400 },
    );
  }

  await ensureDb();
  const now = new Date().toISOString();
  const email = await currentEmail();
  await db
    .insert(navLayout)
    .values({ id: HOME_LAYOUT_ID, value: JSON.stringify(layout), updatedAt: now, updatedBy: email })
    .onConflictDoUpdate({
      target: navLayout.id,
      set: { value: JSON.stringify(layout), updatedAt: now, updatedBy: email },
    });

  return NextResponse.json({ ok: true, layout, isCustom: true });
}

export async function DELETE() {
  if (!(await requireAdmin())) return FORBIDDEN;
  await ensureDb();
  await db.delete(navLayout).where(eq(navLayout.id, HOME_LAYOUT_ID));
  return NextResponse.json({ ok: true, layout: defaultLayout(), isCustom: false });
}
