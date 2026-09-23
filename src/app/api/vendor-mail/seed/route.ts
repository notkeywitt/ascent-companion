import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { companyDateParts } from "@/lib/billing";
import { matchVendor } from "@/lib/digest/checks/uncapturedBills";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getVendorEmails } from "@/lib/jobtread";
import { proposeSeeds, type SeedEmail } from "@/lib/vendorMail";

/**
 * FILL THE INDEX FROM MAIL THAT ALREADY ARRIVED.
 *
 * The vendor-mail check searches by the addresses on file in JobTread, so a
 * vendor with no address is invisible to it. 136 of 238 vendors were un-indexed
 * when this was written — too many to type by hand, which is the whole reason
 * this exists.
 *
 * It sweeps the last few billing periods with `listPeriodBillEmails` (the same
 * read the monthly invoice review uses — all mail, metadata only, nothing
 * written), matches each un-indexed sender against the vendors that still have
 * no address, and returns PROPOSALS. It writes nothing: the office approves each
 * one and `/api/vendor-details` performs the write, journaled, one vendor at a
 * time.
 *
 * The sender→vendor match here is the digest's fuzzy name/domain heuristic —
 * the very thing an exact address index exists to replace. That is precisely why
 * the output is a proposal and not a write.
 *
 * GET /api/vendor-mail/seed?months=3
 *   → { ok, coverage:{total,indexed,missing,pct}, candidates:[…], swept:{months,emails} }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Billing periods to sweep. Three covers a quarterly biller without making the
 *  office wait on six serialized Apps Script calls. */
const DEFAULT_MONTHS = 3;
const MAX_MONTHS = 6;

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const asked = Number(req.nextUrl.searchParams.get("months"));
  const months = Math.min(MAX_MONTHS, Math.max(1, Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_MONTHS));

  try {
    const vendors = await getVendorEmails(getPaveConfig());
    const known = new Set(vendors.flatMap((v) => v.addresses));
    const unindexed = vendors.filter((v) => v.addresses.length === 0).map((v) => ({ id: v.id, name: v.name }));

    // Walk back from the current month. Apps Script serializes these, so they run
    // one at a time by nature — no point firing them in parallel.
    const { year, month } = companyDateParts(new Date());
    const emails: SeedEmail[] = [];
    const swept: string[] = [];
    for (let i = 0; i < months; i++) {
      const m = ((month - 1 - i) % 12 + 12) % 12 + 1;
      const y = year + Math.floor((month - 1 - i) / 12);
      const r = await callAppsScript<{ ok?: boolean; emails?: SeedEmail[]; error?: string }>(
        { action: "listPeriodBillEmails", month: m, year: y },
        { timeoutMs: 35_000 },
      );
      // One unreadable period shouldn't lose the others — say which were read.
      if (r.error || r.data?.ok === false) continue;
      swept.push(`${y}-${String(m).padStart(2, "0")}`);
      emails.push(...(r.data?.emails ?? []));
    }

    const candidates = proposeSeeds(emails, known, unindexed, matchVendor);
    const indexed = vendors.length - unindexed.length;
    return NextResponse.json({
      ok: true,
      coverage: {
        total: vendors.length,
        indexed,
        missing: unindexed.length,
        pct: vendors.length ? Math.round((indexed / vendors.length) * 100) : 0,
      },
      swept: { months: swept, emails: emails.length },
      candidates,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
