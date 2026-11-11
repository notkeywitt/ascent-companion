/**
 * Admin → Stage 7 backfill and check (docs/plans/STAGE7_TOOLS_MILEAGE.md).
 *
 *   GET ?dataset=tools|mileage            → the sheet against the DB table:
 *        { ok, dataset, sheet, db, missingFromDb, notOnSheet, changed }
 *   GET ?dataset=tools|mileage&backfill=1 → copy the sheet into the table,
 *        then answer with the same check.
 *
 * A GET that writes, on purpose: the owner runs it by opening a URL. The copy
 * is sheet → companion DB only, it is safe to repeat, and nothing reads the
 * table yet. It writes nothing to the sheet and nothing to JobTread.
 *
 * Mileage needs the signed-in person to be on Apps Script's mileage admin list
 * (MLG_ADMIN_EMAILS in ascent-appscript/Mileage.js); anyone else gets only
 * their own trips from the sheet, which is not a backfill.
 *
 * Admin-only, same `requireAdmin()` shape as /api/admin/build.
 */
import { NextRequest, NextResponse } from "next/server";

import { auth, envAllowed } from "@/auth";
import { compareMileage, compareTools, syncMileage, syncTools } from "@/lib/sheetTables";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (!(session?.user?.role === "admin" || envAllowed().includes(email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const dataset = req.nextUrl.searchParams.get("dataset");
  const backfill = req.nextUrl.searchParams.get("backfill") === "1";
  try {
    if (dataset === "tools") {
      if (backfill) await syncTools();
      return NextResponse.json({ ok: true, dataset, ...(await compareTools()) });
    }
    if (dataset === "mileage") {
      // compareMileage runs first: it refuses a non-admin answer before anything is written.
      const before = await compareMileage(email);
      if (!backfill) return NextResponse.json({ ok: true, dataset, ...before });
      await syncMileage(email);
      return NextResponse.json({ ok: true, dataset, ...(await compareMileage(email)) });
    }
    return NextResponse.json({ error: "dataset must be tools or mileage." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
