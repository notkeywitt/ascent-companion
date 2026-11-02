import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getVendorAddresses, getVendors } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Shared Data Cache for the org's vendor accounts (reference data, not editable via the
// Companion). 30-min window matches the existing in-memory ref TTL, but is shared across
// lambdas and survives cold starts. See /api/jobs for the rationale.
//
// Each vendor carries its JobTread address, when it has one, so the header search box
// can match on it. The address read is best-effort: if it fails, the names still load.
const getCachedVendors = unstable_cache(
  async () => {
    const cfg = getPaveConfig();
    const [vendors, addresses] = await Promise.all([
      getVendors(cfg),
      getVendorAddresses(cfg).catch(() => ({}) as Record<string, string>),
    ]);
    return vendors.map((v) => (addresses[v.id] ? { ...v, address: addresses[v.id] } : v));
  },
  ["api-vendors-with-address"],
  {
    revalidate: 1800,
    tags: ["jt-vendors"],
  },
);

// Read-only: the org's vendor accounts, for the RFI assignee dropdown and the search box.
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
