import { NextRequest, NextResponse } from "next/server";

import { digestDateKey } from "@/lib/digest/run";
import { readDigest, readLatestDigest } from "@/lib/digest/store";
import { DIGEST_CATEGORIES } from "@/lib/digest/settings";
import { CHECKS } from "@/lib/digest/registry";

/**
 * GET /api/digest — today's stored digest, for the home screen.
 *
 * READS ONLY. This route never runs the checks: the home screen must not pay
 * for a JobTread sweep and two Gmail scans on page load, and two admins opening
 * the app at 7am must not both trigger one. The scheduled job (POST
 * /api/digest/run) is what produces a digest; this hands back what it stored.
 *
 * When today's run hasn't happened yet, the most recent digest is returned with
 * `stale: true` and its own date, so the UI can say "from yesterday" rather than
 * show an empty screen. Pass ?date=YYYY-MM-DD to read a specific day.
 *
 * Gated by the `digest` view (see lib/views.ts), enforced in middleware.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const today = digestDateKey();
  const asked = req.nextUrl.searchParams.get("date")?.trim();

  try {
    const digest = asked ? await readDigest(asked) : ((await readDigest(today)) ?? (await readLatestDigest()));
    return NextResponse.json({
      today,
      digest,
      stale: Boolean(digest && digest.date !== today),
      // Category metadata rides along so the UI stays data-driven: adding a
      // category is an edit to settings.ts, never to the rendering code.
      categories: DIGEST_CATEGORIES,
      // Which checks exist and whether they're switched on — so a check that
      // was disabled shows as "off", not as if it had silently disappeared.
      checks: CHECKS.map((c) => ({ id: c.id, title: c.title, category: c.category, enabled: c.enabled })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
