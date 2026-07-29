import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getVendors } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Shared Data Cache for the org's vendor accounts (reference data, not editable via the
// Companion). 30-min window matches the existing in-memory ref TTL, but is shared across
// lambdas and survives cold starts. See /api/jobs for the rationale.
const getCachedVendors = unstable_cache(() => getVendors(getPaveConfig()), ["api-vendors"], {
  revalidate: 1800,
  tags: ["jt-vendors"],
});

// Read-only: the org's vendor accounts, for the RFI assignee dropdown.
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const vendors = await getCachedVendors();
    return NextResponse.json({ vendors });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
