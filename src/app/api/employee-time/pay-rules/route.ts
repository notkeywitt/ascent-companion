import { NextRequest, NextResponse } from "next/server";

import { resolveTimeIdentity } from "@/lib/actingAs";
import { listPayTypeRules } from "@/lib/payTypeRules";

/**
 * The pay-type rules for whoever this time page is about — the signed-in
 * person, or (admin, office) the person in `?actingAs`. Read-only, so every
 * role may ask for their own; the editor is /api/labor-rates/rules.
 *
 *   GET ?actingAs= → { ok, rules }
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const who = await resolveTimeIdentity((req.nextUrl.searchParams.get("actingAs") ?? "").trim(), {
    readOnly: true,
  });
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  return NextResponse.json({ ok: true, rules: await listPayTypeRules(who.identity.jtUserId) });
}
