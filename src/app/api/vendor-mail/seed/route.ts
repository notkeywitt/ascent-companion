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
 * when this was written — too many to type by hand, which is why this exists.
 *
 * ONE BILLING PERIOD PER REQUEST. `listPeriodBillEmails` sweeps all mail for a
 * whole month and routinely takes most of a minute; three of them in one request
 * blew the function budget and — because the first version skipped a failed
 * period silently — reported "0 emails across 0 periods" as though the mailbox
 * were empty. The caller now walks the periods one at a time and a failure says
 * which period failed and why.
 *
 * The sender→vendor match is the digest's fuzzy name/domain heuristic — the very
 * thing an exact address index exists to replace. That is why the output is a
 * proposal: the office approves each one and `/api/vendor-details` performs the
 * write, journaled.
 *
 * GET /api/vendor-mail/seed?back=0
 *   back=0 is the current billing period, 1 the one before, and so on.
 *   → { ok, period, coverage, swept:{emails}, candidates:[…] }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BACK = 11;

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const askedBack = Number(req.nextUrl.searchParams.get("back"));
  const back = Math.min(MAX_BACK, Math.max(0, Number.isFinite(askedBack) ? Math.trunc(askedBack) : 0));

  try {
    const vendors = await getVendorEmails(getPaveConfig());
    const known = new Set(vendors.flatMap((v) => v.addresses));
    const unindexed = vendors
      .filter((v) => v.addresses.length === 0)
      .map((v) => ({ id: v.id, name: v.name }));
    const indexed = vendors.length - unindexed.length;
    const coverage = {
      total: vendors.length,
      indexed,
      missing: unindexed.length,
      pct: vendors.length ? Math.round((indexed / vendors.length) * 100) : 0,
    };

    const { year, month } = companyDateParts(new Date());
    const m = (((month - 1 - back) % 12) + 12) % 12 + 1;
    const y = year + Math.floor((month - 1 - back) / 12);
    const period = `${y}-${String(m).padStart(2, "0")}`;

    const r = await callAppsScript<{ ok?: boolean; emails?: SeedEmail[]; error?: string }>(
      { action: "listPeriodBillEmails", month: m, year: y },
      // One month of all-mail metadata. Generous, because the failure this
      // replaces was a timeout reported as an empty mailbox.
      { timeoutMs: 100_000, retry: false },
    );
    // A failed sweep is an ERROR, never an empty result — "nothing found" and
    // "nothing looked" must not render the same way.
    if (r.error) {
      return NextResponse.json({ ok: false, period, coverage, error: r.error }, { status: 502 });
    }
    if (r.data?.ok === false) {
      return NextResponse.json(
        { ok: false, period, coverage, error: r.data.error ?? "Apps Script reported a failure." },
        { status: 502 },
      );
    }

    const emails = r.data?.emails ?? [];
    return NextResponse.json({
      ok: true,
      period,
      coverage,
      swept: { emails: emails.length },
      candidates: proposeSeeds(emails, known, unindexed, matchVendor),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
