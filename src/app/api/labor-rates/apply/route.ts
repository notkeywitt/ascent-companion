import { NextRequest, NextResponse } from "next/server";
import {
  clearJtRefCache,
  getMembershipRates,
  updateMembershipRates,
  type PayType,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Apply labor rates to JobTread members via updateMembership (a WHOLE-ARRAY
 * replace of the membership's timeEntryTypes). DISABLED BY DEFAULT: unless
 * COMPANION_WRITES_ENABLED=true this writes nothing and returns a preview,
 * matching /api/add-line. Office/admin-gated by middleware.
 *
 * Modes:
 *  - "set":        exact replace — write `types` as the member's COMPLETE new set
 *                  (per-employee editor pre-loads current types, so nothing is
 *                  dropped unless the user removed it). One membershipId.
 *  - "applyRate":  bulk upsert — for each membershipId, read current types fresh,
 *                  add/replace the one `rate` by name, write back. Additive: never
 *                  touches the member's other types.
 *  - "removeRate": bulk remove the type named `name` from each membershipId.
 * applyRate/removeRate do a per-member read-modify-write server-side so a stale
 * client can't clobber a member's other rates.
 */

type Rate = { name: string; hourlyRate: number };

function normOne(v: unknown): Rate | null {
  const o = (v ?? {}) as { name?: unknown; hourlyRate?: unknown };
  const name = String(o.name ?? "").trim();
  const hourlyRate = Number(String(o.hourlyRate ?? "").replace(/[$,\s]/g, ""));
  if (!name || !Number.isFinite(hourlyRate) || hourlyRate < 0) return null;
  return { name, hourlyRate };
}
function normMany(v: unknown): Rate[] {
  return (Array.isArray(v) ? v : []).map(normOne).filter((r): r is Rate => r !== null);
}
const upsertByName = (current: PayType[], rate: Rate): Rate[] => [
  ...current
    .filter((t) => t.name !== rate.name)
    .map((t) => ({ name: t.name, hourlyRate: Number(t.hourlyRate ?? 0) })),
  rate,
];

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const mode = body?.mode;
  if (!body || !["set", "applyRate", "removeRate"].includes(mode)) {
    return NextResponse.json({ error: "mode must be set | applyRate | removeRate" }, { status: 400 });
  }

  // Validate inputs BEFORE the write gate so a preview still reports bad input.
  let membershipIds: string[] = [];
  let setTypes: Rate[] = [];
  let rate: Rate | null = null;
  let removeName = "";
  if (mode === "set") {
    const id = String(body.membershipId ?? "").trim();
    if (!id) return NextResponse.json({ error: "membershipId is required" }, { status: 400 });
    membershipIds = [id];
    setTypes = normMany(body.types);
  } else {
    membershipIds = (Array.isArray(body.membershipIds) ? body.membershipIds : [])
      .map((x: unknown) => String(x ?? "").trim())
      .filter(Boolean);
    if (!membershipIds.length)
      return NextResponse.json({ error: "membershipIds is required" }, { status: 400 });
    if (mode === "applyRate") {
      rate = normOne(body.rate);
      if (!rate) return NextResponse.json({ error: "a valid rate {name, hourlyRate} is required" }, { status: 400 });
    } else {
      removeName = String(body.name ?? "").trim();
      if (!removeName) return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message:
        "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was written to JobTread.",
      wouldAffect: membershipIds.length,
    });
  }

  const cfg = getPaveConfig();
  const results: { membershipId: string; ok: boolean; error?: string; types?: PayType[] }[] = [];
  try {
    if (mode === "set") {
      const membershipId = membershipIds[0];
      const types = await updateMembershipRates(cfg, membershipId, setTypes);
      results.push({ membershipId, ok: true, types });
    } else {
      for (const membershipId of membershipIds) {
        try {
          const current = await getMembershipRates(cfg, membershipId);
          const next =
            mode === "applyRate"
              ? upsertByName(current, rate as Rate)
              : current
                  .filter((t) => t.name !== removeName)
                  .map((t) => ({ name: t.name, hourlyRate: Number(t.hourlyRate ?? 0) }));
          const types = await updateMembershipRates(cfg, membershipId, next);
          results.push({ membershipId, ok: true, types });
        } catch (e) {
          results.push({ membershipId, ok: false, error: e instanceof Error ? e.message : "failed" });
        }
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  } finally {
    clearJtRefCache(); // roster re-reads fresh rates next load
  }

  return NextResponse.json({ wrote: true, results });
}
