import { NextResponse } from "next/server";
import { getVendors } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Read-only: the org's vendor accounts, for the RFI assignee dropdown.
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const vendors = await getVendors(getPaveConfig());
    return NextResponse.json({ vendors });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
