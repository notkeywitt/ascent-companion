import { NextResponse } from "next/server";
import { getOrgUsers } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Internal JobTread members + each one's CURRENT pay types (labor rates), for the
 * /labor-rates assignment UI. Read-only. Only members with a writable
 * `membershipId` are returned (that's the id updateMembership needs). Office/
 * admin-gated by middleware. NOTE: getOrgUsers is cached ~30 min in-process, so a
 * rate changed directly in JobTread can lag here; an apply clears that cache.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const users = await getOrgUsers(getPaveConfig());
    const members = users
      .filter((u) => u.isInternal && u.membershipId)
      .map((u) => ({
        membershipId: u.membershipId as string,
        userId: u.id,
        name: u.name,
        types: (u.types ?? []).map((t) => ({ name: t.name, hourlyRate: t.hourlyRate ?? 0 })),
        // true only if the grant could read per-member types (else rates unknown)
        ratesReadable: u.types !== undefined,
      }));
    return NextResponse.json({ members });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
