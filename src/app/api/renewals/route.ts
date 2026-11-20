import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { companyDetails } from "@/db/schema";
import { cleanRenewals, seedRenewals, type Renewal } from "@/lib/renewals";

/**
 * Company renewals list — one JSON row under key "renewals" in company_details.
 * Companion DB only; nothing here touches JobTread. Gated by the "renewals" view.
 *
 * GET → { renewals }   (the eight starter names, undated, when nothing is saved)
 * PUT { renewals } → { renewals }   (replaces the whole list)
 */
export const dynamic = "force-dynamic";

async function read(): Promise<Renewal[]> {
  await ensureDb();
  const [row] = await db.select().from(companyDetails).where(eq(companyDetails.key, "renewals"));
  if (!row) return seedRenewals();
  try {
    return cleanRenewals(JSON.parse(row.value)) ?? seedRenewals();
  } catch {
    return seedRenewals();
  }
}

export async function GET() {
  return NextResponse.json({ renewals: await read() });
}

export async function PUT(req: NextRequest) {
  let body: { renewals?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const list = cleanRenewals(body?.renewals);
  if (!list) return NextResponse.json({ error: "renewals must be a list" }, { status: 400 });
  const session = await auth();
  const set = { value: JSON.stringify(list), updatedAt: new Date().toISOString(), updatedBy: session?.user?.email ?? "" };
  await ensureDb();
  await db.insert(companyDetails).values({ key: "renewals", ...set }).onConflictDoUpdate({ target: companyDetails.key, set });
  return NextResponse.json({ renewals: list });
}
