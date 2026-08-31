import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { digestSettingsOverrides } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { CHECKS } from "@/lib/digest/registry";
import { DIGEST_SETTINGS } from "@/lib/digest/settings";
import { getDigestOverrides, mergeSettings, type DigestOverride } from "@/lib/digest/overrides";

/**
 * /admin's Digest tab — read and edit the Daily Digest's per-check settings
 * (enabled + config) without a redeploy. See src/lib/digest/overrides.ts for
 * why this is read fresh on every real digest run rather than cached.
 *
 * Same admin gate as every other /api/admin/* and /api/team/* route in this
 * app (duplicated per-route rather than shared — that's this codebase's own
 * existing convention, not an oversight).
 */
async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  return session?.user?.role === "admin" || envAllowed().includes(email);
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

const DEFAULTS = DIGEST_SETTINGS as Record<string, { enabled: boolean; config: unknown }>;

async function currentSettings() {
  const overrides = await getDigestOverrides();
  const merged = mergeSettings(overrides);
  return CHECKS.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    default: DEFAULTS[c.id],
    override: overrides[c.id] ?? null,
    effective: merged[c.id],
  }));
}

export async function GET() {
  if (!(await requireAdmin())) return FORBIDDEN;
  return NextResponse.json({ checks: await currentSettings() });
}

// PATCH { checkId, enabled?: boolean, config?: Record<string, unknown> } — a
// config override is a PARTIAL that merges onto whatever's already stored
// (see mergeSettings), so changing one field never blanks out the rest.
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return FORBIDDEN;
  const body = await req.json().catch(() => ({}));
  const checkId = typeof body.checkId === "string" ? body.checkId : "";
  const defaults = DEFAULTS[checkId];
  if (!defaults) return NextResponse.json({ error: "Unknown checkId" }, { status: 400 });

  let enabled: boolean | undefined;
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    enabled = body.enabled;
  }

  let configPatch: Record<string, unknown> | undefined;
  if (body.config !== undefined) {
    if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) {
      return NextResponse.json({ error: "config must be an object" }, { status: 400 });
    }
    const knownKeys = new Set(Object.keys(defaults.config as object));
    const badKey = Object.keys(body.config).find((k) => !knownKeys.has(k));
    if (badKey) return NextResponse.json({ error: `Unknown config key: ${badKey}` }, { status: 400 });
    configPatch = body.config;
  }

  if (enabled === undefined && configPatch === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await ensureDb();
  const existing: DigestOverride | undefined = (await getDigestOverrides())[checkId];
  const nextEnabled = enabled !== undefined ? enabled : (existing?.enabled ?? null);
  const nextConfig =
    configPatch !== undefined ? { ...(existing?.config ?? {}), ...configPatch } : (existing?.config ?? null);

  const values = {
    checkId,
    enabled: nextEnabled,
    config: nextConfig ? JSON.stringify(nextConfig) : null,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(digestSettingsOverrides)
    .values(values)
    .onConflictDoUpdate({ target: digestSettingsOverrides.checkId, set: values });

  return NextResponse.json({ checks: await currentSettings() });
}

// DELETE ?checkId=... — reset one check back to its settings.ts default.
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return FORBIDDEN;
  const checkId = req.nextUrl.searchParams.get("checkId") ?? "";
  if (!DEFAULTS[checkId]) return NextResponse.json({ error: "Unknown checkId" }, { status: 400 });

  await ensureDb();
  await db.delete(digestSettingsOverrides).where(eq(digestSettingsOverrides.checkId, checkId));

  return NextResponse.json({ checks: await currentSettings() });
}
