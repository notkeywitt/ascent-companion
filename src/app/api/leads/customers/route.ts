import { NextRequest, NextResponse } from "next/server";

import { getPaveConfig, hasGrant } from "@/lib/config";
import { searchCustomers } from "@/lib/leadPush";

/**
 * GET /api/leads/customers?q=<text> — JobTread customers whose name holds `q`.
 * Read-only. Feeds the "connect to an existing customer" picker on a lead.
 * Rides the "leads" view (path prefix /api/leads).
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  try {
    return NextResponse.json({ customers: await searchCustomers(getPaveConfig(), q) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
