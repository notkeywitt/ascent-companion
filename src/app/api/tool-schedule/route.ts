import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { buildToolSchedule, rangeFromUrl } from "@/lib/toolScheduleData";

/**
 * GET /api/tool-schedule[?months=6 | ?from=&to=] — the tool schedule: per tool
 * type, which jobs need it on which days (from the JobTread schedules), what is
 * owned, the shortfalls and the moves coming up. Read only: nothing here writes
 * to JobTread or the Tools sheet. Gated by the "tool-schedule" view (all roles).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const { from, to } = rangeFromUrl(new URL(req.url));
  try {
    return NextResponse.json(await buildToolSchedule(from, to));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not build the tool schedule." }, { status: 502 });
  }
}
