import { NextRequest, NextResponse } from "next/server";

import { hasGrant } from "@/lib/config";
import { resolveTimeIdentity } from "@/lib/actingAs";
import { getTimeClockJobs } from "@/lib/jobsCache";

/**
 * The time clock's job list: the open jobs the employee is added to in
 * JobTread, in a phase that takes time (lib/timeClockJobs).
 *
 * GET ?actingAs=<jtUserId> — ADMIN or OFFICE: that person's jobs instead.
 *   → { ok, jobs }
 *
 * The page's server shell preloads the signed-in person's list. The client
 * calls this when it had no preload, or when an admin opens the page as
 * someone else.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const who = await resolveTimeIdentity((req.nextUrl.searchParams.get("actingAs") ?? "").trim());
  // No linked JobTread user yet: filter by phase only, like the shell does.
  if (!who.ok && who.status !== 400) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  try {
    const jobs = await getTimeClockJobs(who.ok ? who.identity.jtUserId : "");
    return NextResponse.json({ ok: true, jobs });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not load jobs." },
      { status: 502 },
    );
  }
}
