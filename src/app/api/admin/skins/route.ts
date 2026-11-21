import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { userSkins } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { isPalette } from "@/lib/palette";

/**
 * Admin → Skins. The skin an admin set for each person (`user_skins`). A set
 * skin overrides that person's per-device choice everywhere they sign in.
 * Companion data only; nothing here touches JobTread.
 */

async function requireAdmin() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const isAdmin = session?.user?.role === "admin" || envAllowed().includes(email);
  return { isAdmin, email };
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

async function allSkins(): Promise<Record<string, string>> {
  const rows = await db.select().from(userSkins);
  return Object.fromEntries(rows.map((r) => [r.email, r.palette]));
}

// GET — { skins: { email: palette } }
export async function GET() {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  await ensureDb();
  return NextResponse.json({ skins: await allSkins() });
}

// PUT { email, palette } — set one person's skin. palette null = device chooses.
export async function PUT(req: NextRequest) {
  const { isAdmin, email: me } = await requireAdmin();
  if (!isAdmin) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });

  await ensureDb();
  if (body.palette === null || body.palette === "") {
    await db.delete(userSkins).where(eq(userSkins.email, email));
  } else if (typeof body.palette === "string" && isPalette(body.palette)) {
    const now = new Date().toISOString();
    await db
      .insert(userSkins)
      .values({ email, palette: body.palette, setBy: me, updatedAt: now })
      .onConflictDoUpdate({ target: userSkins.email, set: { palette: body.palette, setBy: me, updatedAt: now } });
  } else {
    return NextResponse.json({ error: "invalid skin" }, { status: 400 });
  }
  return NextResponse.json({ skins: await allSkins() });
}
