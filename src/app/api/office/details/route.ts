import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { readDetails, writeDetails } from "@/lib/companyDetails";
import { cleanDetailsInput } from "@/lib/companyDetailsRules";
import { openJournal } from "@/lib/financialJournal";

/**
 * Ascent's own details (tax rate, P&O, UBI, reseller permit, contractor
 * license) — the Office Dashboard's Ascent Details card. Companion-only; nothing
 * here touches JobTread or the sheet. Gated by the "office" view
 * (src/lib/views.ts): office + admin.
 *
 * GET → { values, updatedAt, updatedBy }
 * PUT { tax?, po?, ubi?, reseller_permit?, contractor_license? } → the saved state.
 *   A rate is typed as a percent ("8.35") and stored as a decimal ("0.0835").
 *   Every changed field goes in the financial journal.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readDetails());
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { values, error } = cleanDetailsInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const session = await auth();
  const changed = await writeDetails(values, session?.user?.email ?? "");
  if (changed.length > 0) {
    const journal = await openJournal("/api/office/details");
    await journal.record(
      changed.map((c) => ({
        action: "company-detail.set",
        entity: "company-detail",
        entityId: c.key,
        field: c.key,
        before: c.before,
        after: c.after,
        beforeSource: "read" as const,
      })),
    );
  }
  return NextResponse.json(await readDetails());
}
