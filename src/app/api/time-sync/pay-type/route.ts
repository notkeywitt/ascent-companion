import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { clearJtRefCache } from "@/lib/jobtread";
import { canSeePayRates } from "@/lib/payRates";
import { addPayType } from "@/lib/timeSync";

/**
 * Office/admin — add ONE missing pay type to an employee's JobTread membership,
 * from the Time Sync editor. A JobTread write, gated by COMPANION_WRITES_ENABLED.
 * See `addPayType` for why it re-reads and refuses on an untrusted read.
 *
 * POST { userId, name, hourlyRate } → { ok, names?, error? }
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // The view gate already limits this to office/admin. Rates are pay data, so
  // the write checks the same rule the roster uses to show them.
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!canSeePayRates(role)) return NextResponse.json({ ok: false, error: "Office or admin only." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { userId?: unknown; name?: unknown; hourlyRate?: unknown } | null;
  const userId = String(body?.userId ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const hourlyRate = Number(String(body?.hourlyRate ?? "").replace(/[$,\s]/g, ""));
  if (!userId || !name) return NextResponse.json({ ok: false, error: "userId and name are required." }, { status: 400 });

  try {
    return NextResponse.json(await addPayType(userId, name, hourlyRate));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not add the pay type." },
      { status: 502 },
    );
  } finally {
    clearJtRefCache(); // the roster re-reads pay types on the next load
    revalidateTag("jt-users");
  }
}
