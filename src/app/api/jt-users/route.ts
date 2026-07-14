import { NextResponse } from "next/server";
import { getOrgUsers, getOrgTimeEntryTypeNames } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

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
    const cfg = getPaveConfig();
    const [users, orgTypes] = await Promise.all([
      getOrgUsers(cfg),
      getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]),
    ]);
    return NextResponse.json({ users, orgTypes });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
