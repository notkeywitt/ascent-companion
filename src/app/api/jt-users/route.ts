import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getOrgUsers, getOrgTimeEntryTypeNames } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Shared Data Cache for the org's JobTread users + pay-type names (reference data used by
// the labor importer / employee linker, not editable via the Companion). 30-min window,
// shared across lambdas and cold-start-proof. See /api/jobs for the rationale.
const getCachedJtUsers = unstable_cache(
  async () => {
    const cfg = getPaveConfig();
    const [users, orgTypes] = await Promise.all([
      getOrgUsers(cfg),
      getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]),
    ]);
    return { users, orgTypes };
  },
  ["api-jt-users"],
  { revalidate: 1800, tags: ["jt-users"] },
);

/**
 * Read-only: the org's JobTread users (+ each one's pay types), for the labor
 * importer's worker and Type mapping.
 *
 * JobTread matches a time entry's user on its DISPLAY name ("Cedar", "Tommy",
 * but "Ty O'Steen"), so the importer maps each QB worker to a real user id here
 * rather than guessing a name from the QB first name.
 *
 * A time entry's `type` is a PAY TYPE, and every member has their own set (they
 * are job-scoped: "Velorum - PM", "Ruhmann Warren - Principal"). `users[].types`
 * is that per-member set; it's absent if the grant can't read it, in which case
 * `orgTypes` (every type name on the org) is the fallback to choose from.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getCachedJtUsers());
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
