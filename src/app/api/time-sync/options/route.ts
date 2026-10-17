import { NextRequest, NextResponse } from "next/server";

import { getPaveConfig, hasGrant } from "@/lib/config";
import { getTimeTrackableLeaves } from "@/lib/jobtread";
import { payTypesFor } from "@/lib/timeSync";

/**
 * Office/admin — the choices the Time Sync editor offers. Read-only.
 *
 *   GET ?userId=<jtUserId>  → { ok, payTypes:[name] }   the pay types JobTread
 *                             takes on that person's entries
 *   GET ?jobId=<id>         → { ok, laborOnly, costItems:[{id, number, name,
 *                             detail, costType}] }      the lines time may be coded to
 *
 * Both in one call when both are passed.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const q = req.nextUrl.searchParams;
  const userId = (q.get("userId") ?? "").trim();
  const jobId = (q.get("jobId") ?? "").trim();
  try {
    const [payTypes, leaves] = await Promise.all([
      userId ? payTypesFor(userId) : Promise.resolve(undefined),
      jobId ? getTimeTrackableLeaves(getPaveConfig(), jobId) : Promise.resolve(undefined),
    ]);
    return NextResponse.json({
      ok: true,
      ...(payTypes ? { payTypes } : {}),
      ...(leaves
        ? {
            laborOnly: leaves.filtered,
            costItems: leaves.items.map((b) => ({
              id: b.id,
              number: b.number,
              name: b.name,
              detail: b.detail,
              costType: b.costType,
            })),
          }
        : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not load the choices." },
      { status: 502 },
    );
  }
}
