import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { vendorCoi } from "@/db/schema";
import { getPaveConfig, hasGrant } from "@/lib/config";
import {
  getRecentVendorBills,
  getVendorCoiFields,
  getVendorEmails,
} from "@/lib/jobtread";
import {
  billedSince,
  coiNeeded,
  coiRequestList,
  coiState,
  type VendorCoiRow,
} from "@/lib/vendorCoi";

/**
 * COI request state for the Vendors page (owner, 2026-11-09). Rules in
 * src/lib/vendorCoi.ts.
 *
 *   GET → { today, vendors: VendorCoiRow[], request: string[] }
 *         Every vendor that has a JobTread field set, a companion row, or a
 *         bill in the past year. `request` is the account ids the "Request
 *         COIs" button asks.
 *   POST { accountIds: string[], requestedOn: "YYYY-MM-DD" }
 *         Records a COI request. "" clears it.
 *   POST { accountId, coiNeeded: true | false | null }
 *         The office's "COI needed" choice. null = Auto.
 *
 * Writes only the companion table, never JobTread. The expiry date is saved
 * through /api/vendor-details. Gated by the "vendors" view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Today in Pacific time, "YYYY-MM-DD". */
function todayPacific(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export async function GET() {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const cfg = getPaveConfig();
  const today = todayPacific();
  try {
    await ensureDb();
    const [emails, fields, bills, rows] = await Promise.all([
      getVendorEmails(cfg),
      getVendorCoiFields(cfg),
      getRecentVendorBills(cfg, billedSince(today)),
      db.select().from(vendorCoi),
    ]);

    // Newest non-void bill per vendor. `denied` is the void (CLAUDE.md).
    const lastBill = new Map<string, string>();
    for (const b of bills) {
      if (b.status === "denied" || !b.vendorId || !b.issueDate) continue;
      if ((lastBill.get(b.vendorId) ?? "") < b.issueDate) lastBill.set(b.vendorId, b.issueDate);
    }
    const local = new Map(rows.map((r) => [r.accountId, r]));

    const vendors: VendorCoiRow[] = [];
    for (const v of emails) {
      const f = fields[v.id];
      const r = local.get(v.id);
      const last = lastBill.get(v.id) ?? "";
      if (!f && !r && !last) continue;
      const override = r?.coiNeeded == null ? null : r.coiNeeded === 1;
      const vendorType = f?.vendorType ?? "";
      const coiExpires = f?.coiExpires ?? "";
      vendors.push({
        id: v.id,
        name: v.name,
        vendorType,
        coiExpires,
        override,
        lastBillOn: last,
        emails: v.addresses,
        lastRequestedOn: r?.lastRequestedOn ?? "",
        needed: coiNeeded(v.name, vendorType, override),
        state: coiState(coiExpires, today),
      });
    }
    const request = coiRequestList(vendors, today).map((v) => v.id);
    return NextResponse.json({ today, vendors, request });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const session = await auth();
  const by = session?.user?.email ?? "";
  const now = new Date().toISOString();

  try {
    await ensureDb();

    if (Array.isArray(body.accountIds)) {
      const ids = [...new Set(body.accountIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
      const on = String(body.requestedOn ?? "").trim();
      if (ids.length === 0 || ids.length > 500) {
        return NextResponse.json({ error: "Pass 1 to 500 accountIds." }, { status: 400 });
      }
      if (on && !/^\d{4}-\d{2}-\d{2}$/.test(on)) {
        return NextResponse.json({ error: "requestedOn must be YYYY-MM-DD." }, { status: 400 });
      }
      for (const id of ids) {
        await db
          .insert(vendorCoi)
          .values({ accountId: id, lastRequestedOn: on, updatedBy: by, updatedAt: now })
          .onConflictDoUpdate({
            target: vendorCoi.accountId,
            set: { lastRequestedOn: on, updatedBy: by, updatedAt: now },
          });
      }
      const saved = await db.select().from(vendorCoi).where(inArray(vendorCoi.accountId, ids));
      return NextResponse.json({ ok: true, saved: saved.length });
    }

    const accountId = String(body.accountId ?? "").trim();
    if (!accountId || !("coiNeeded" in body)) {
      return NextResponse.json(
        { error: "Pass { accountIds, requestedOn } or { accountId, coiNeeded }." },
        { status: 400 },
      );
    }
    const v = body.coiNeeded;
    if (v !== null && typeof v !== "boolean") {
      return NextResponse.json({ error: "coiNeeded must be true, false or null." }, { status: 400 });
    }
    const coiNeededVal = v === null ? null : v ? 1 : 0;
    await db
      .insert(vendorCoi)
      .values({ accountId, coiNeeded: coiNeededVal, updatedBy: by, updatedAt: now })
      .onConflictDoUpdate({
        target: vendorCoi.accountId,
        set: { coiNeeded: coiNeededVal, updatedBy: by, updatedAt: now },
      });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
