/**
 * Admin → Page Text: read and edit the on-screen copy registered in
 * src/lib/copy.ts.
 *
 * GET  → { entries: [{ key, label, group, text, value, overridden }] }
 *        `text` is the shipped default, `value` is what renders today.
 * PUT  { key, value } → upsert ONE override. A blank/whitespace value DELETES
 *        the row, which is how the editor's "revert to default" works.
 *
 * Admin-only, same `requireAdmin()` shape as /api/team/roles. Writes are keyed
 * to the registry: an unknown key is rejected, so no dangling row can be created
 * that the editor would never surface again.
 *
 * NOTE this is companion-owned UI text in the companion DB — it touches neither
 * JobTread nor the Sheet, so it is deliberately NOT behind the JobTread write
 * gates (COMPANION_WRITES_ENABLED / the Pave gateway). Nothing here can race the
 * mirror.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { pageCopy } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { COPY, copyByGroup, resolveCopy } from "@/lib/copy";

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

async function overrideMap(): Promise<Record<string, string>> {
  await ensureDb();
  const rows = await db.select().from(pageCopy);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function GET() {
  if (!(await requireAdmin())) return FORBIDDEN;
  const overrides = await overrideMap();
  // Grouped in registry order so the editor renders sections without sorting.
  const groups = copyByGroup().map(({ group, keys }) => ({
    group,
    entries: keys.map((key) => ({
      key,
      label: COPY[key].label,
      short: COPY[key].short ?? false,
      tokens: COPY[key].tokens ?? [],
      text: COPY[key].text, // shipped default
      value: resolveCopy(overrides, key), // what renders today
      overridden: typeof overrides[key] === "string" && overrides[key].trim() !== "",
    })),
  }));
  return NextResponse.json({ groups });
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin())) return FORBIDDEN;

  let body: { key?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key : "";
  if (!(key in COPY)) {
    return NextResponse.json({ error: `Unknown copy key: ${key}` }, { status: 400 });
  }
  const raw = typeof body.value === "string" ? body.value : "";
  const value = raw.trim();

  await ensureDb();

  // Blank = revert: drop the row so the shipped default renders again.
  if (value === "") {
    await db.delete(pageCopy).where(eq(pageCopy.key, key));
    return NextResponse.json({ ok: true, key, value: COPY[key].text, overridden: false });
  }

  await db
    .insert(pageCopy)
    .values({
      key,
      value,
      updatedAt: new Date().toISOString(),
      updatedBy: await currentEmail(),
    })
    .onConflictDoUpdate({
      target: pageCopy.key,
      set: { value, updatedAt: new Date().toISOString(), updatedBy: await currentEmail() },
    });

  return NextResponse.json({ ok: true, key, value, overridden: true });
}
