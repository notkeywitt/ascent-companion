import { NextResponse } from "next/server";
import { getDraftVendorBillCount } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Org-wide count of draft vendor bills (the Coding Review queue across every
// job) — powers the "bills waiting" flag on the Needs Project tab. One cheap
// aggregate query; never errors the caller (returns count:null on failure).
export async function GET() {
  if (!hasGrant()) return NextResponse.json({ count: null });
  try {
    const count = await getDraftVendorBillCount(getPaveConfig());
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: null });
  }
}
