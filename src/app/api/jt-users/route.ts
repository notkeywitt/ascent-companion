import { NextResponse } from "next/server";
import { getOrgUsers } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Read-only: the org's JobTread users, for the labor importer's worker mapping.
// JobTread matches a time entry's user on its DISPLAY name ("Cedar", "Tommy",
// but "Ty O'Steen"), so the importer maps each QB worker to a real user id here
// rather than guessing a name from the QB first name.
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const users = await getOrgUsers(getPaveConfig());
    return NextResponse.json({ users });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
