import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { applyBalanceImport, previewBalanceImport } from "@/lib/leaveService";

/**
 * Office/admin — import the TSheets/QuickBooks PTO + sick balance CSV.
 *
 * POST { csv, commit?, overrides?, label? }
 *   commit=false (default) → parse + diff only, returns the plan to review
 *   commit=true            → writes one signed adjustment per changed balance
 *
 * Companion DB only — this never writes to JobTread, so it is safe with
 * COMPANION_WRITES_ENABLED off.
 */
export const dynamic = "force-dynamic";

interface Body {
  csv?: string;
  commit?: boolean;
  label?: string;
  overrides?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const actor = session?.user?.email ?? "office";
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const csv = String(body.csv ?? "");
  if (!csv.trim()) return NextResponse.json({ ok: false, error: "No CSV content." }, { status: 400 });

  // Only string→string pairs survive; a bad shape can't reach the matcher.
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.overrides ?? {})) {
    if (typeof k === "string" && typeof v === "string") overrides[k.trim().toLowerCase()] = v.trim();
  }

  try {
    if (body.commit === true) {
      const result = await applyBalanceImport({ csv, overrides, label: body.label, actor });
      return NextResponse.json({ ok: true, committed: true, ...result });
    }
    const plan = await previewBalanceImport({ csv, overrides });
    return NextResponse.json({ ok: true, committed: false, ...plan });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Import failed" },
      { status: 400 },
    );
  }
}
