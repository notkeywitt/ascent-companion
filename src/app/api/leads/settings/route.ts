import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { normalizeThresholds } from "@/lib/leadBoard";
import { readLeadSettingsRow, writeQuietThresholds } from "@/lib/leadSettings";

/**
 * The quiet thresholds — when a lead with no logged contact turns amber, and
 * when it turns red.
 *
 * Companion-only; nothing here touches JobTread. Gated by the `leads` view (the
 * `/api/leads` prefix in src/lib/views.ts covers this child route), so office
 * and admin can read and change it — a display threshold is not a money
 * control, and `updatedBy` records who moved it.
 *
 * The reads and the write live in src/lib/leadSettings.ts; this file is only
 * the HTTP shape.
 */

// GET /api/leads/settings — the thresholds, plus who last moved them.
export async function GET() {
  const row = await readLeadSettingsRow();
  return NextResponse.json({
    quiet: normalizeThresholds({ warnDays: row?.warnDays, alertDays: row?.alertDays }),
    updatedAt: row?.updatedAt ?? "",
    updatedBy: row?.updatedBy ?? "",
    /** False until someone saves — the form then says "default", not a name. */
    customized: Boolean(row),
  });
}

// PUT /api/leads/settings — set them. Body: { warnDays, alertDays }.
export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const session = await auth();
  const { quiet, updatedAt } = await writeQuietThresholds(
    { warnDays: body.warnDays, alertDays: body.alertDays },
    session?.user?.email ?? "",
  );
  return NextResponse.json({
    quiet,
    updatedAt,
    updatedBy: session?.user?.email ?? "",
    customized: true,
  });
}
