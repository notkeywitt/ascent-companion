import { NextResponse } from "next/server";

import { checkPrecision, MIN_PRECISION_SAMPLE } from "@/lib/invoiceReview/lifecycle";
import { ALL_CHECKS } from "@/lib/invoiceReview/registry";
import { DEFAULT_SETTINGS } from "@/lib/invoiceReview/settings";

/**
 * How each check has actually been doing — derived, not scored by anyone.
 *
 * A finding that stopped appearing was fixed; one that got a ruling was set
 * aside. See lifecycle.ts for why those two are counted separately and never
 * merged. `precision` is null below MIN_PRECISION_SAMPLE decided findings,
 * because a check with three to its name has anecdotes rather than a precision.
 *
 * Read-only, and it changes nothing: nothing here promotes, demotes or disables
 * a check. It is the evidence a human uses to decide to.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = new Map((await checkPrecision()).map((s) => [s.checkId, s]));
  const blocks = DEFAULT_SETTINGS.checks as unknown as Record<string, { enabled: boolean }>;

  return NextResponse.json({
    minSample: MIN_PRECISION_SAMPLE,
    checks: ALL_CHECKS.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      scope: c.scope,
      finds: c.kinds,
      enabled: blocks[c.id]?.enabled ?? false,
      ...(stats.get(c.id) ?? {
        fixed: 0,
        setAside: 0,
        standing: 0,
        decided: 0,
        precision: null,
      }),
    })),
  });
}
