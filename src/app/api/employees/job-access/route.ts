import { NextRequest, NextResponse } from "next/server";
import { getJobAccessFor, getOrgUsers, grantJobAccess } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Which open JobTread jobs an employee is on, and adding them to more. An
 * employee must be on a job's access list before JobTread lets them clock in to
 * it — the /employees Edit form's "JobTread jobs" section.
 *
 *   GET  ?membershipId=                → { jobs: JobAccessRow[] }
 *   POST { membershipId, jobIds[] }    → { granted, failed[], jobs }
 *
 * Add only. Taking someone off a job stays in JobTread.
 *
 * The POST re-reads the list itself and grants only open jobs the employee is
 * not already on, so a stale page cannot double-add or reach a closed job. The
 * membership must be an INTERNAL member of the org: this route does not hand job
 * access to a customer or vendor login. Gated on the `employees` view
 * (lib/views.ts), so office + admin.
 */
export const maxDuration = 60;

async function internalMembership(membershipId: string): Promise<boolean> {
  const users = await getOrgUsers(getPaveConfig());
  return users.some((u) => u.isInternal && u.membershipId === membershipId);
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const membershipId = req.nextUrl.searchParams.get("membershipId")?.trim() ?? "";
  if (!membershipId) return NextResponse.json({ error: "membershipId is required." }, { status: 400 });
  try {
    return NextResponse.json({ jobs: await getJobAccessFor(getPaveConfig(), membershipId) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read jobs." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const body = await req.json().catch(() => null);
  const membershipId = String(body?.membershipId ?? "").trim();
  const wanted = new Set(
    (Array.isArray(body?.jobIds) ? body.jobIds : []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean),
  );
  if (!membershipId || !wanted.size) {
    return NextResponse.json({ error: "membershipId and jobIds are required." }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json(
      { error: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was written to JobTread." },
      { status: 409 },
    );
  }

  const cfg = getPaveConfig();
  try {
    if (!(await internalMembership(membershipId))) {
      return NextResponse.json({ error: "That is not an internal JobTread member." }, { status: 400 });
    }
    const before = await getJobAccessFor(cfg, membershipId);
    const todo = before.filter((j) => wanted.has(j.id) && !j.hasAccess);

    // Five at a time: ~30 jobs one by one is ~15 s; all at once is a burst
    // JobTread has no reason to accept.
    const failed: { jobId: string; name: string; error: string }[] = [];
    for (let i = 0; i < todo.length; i += 5) {
      await Promise.all(
        todo.slice(i, i + 5).map((j) =>
          grantJobAccess(cfg, j.id, membershipId).catch((e) =>
            failed.push({ jobId: j.id, name: j.name, error: e instanceof Error ? e.message : "failed" }),
          ),
        ),
      );
    }
    const jobs = await getJobAccessFor(cfg, membershipId);
    return NextResponse.json({ granted: todo.length - failed.length, failed, jobs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not add job access." }, { status: 502 });
  }
}
