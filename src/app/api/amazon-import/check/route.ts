import { NextRequest, NextResponse } from "next/server";
import { findExistingExternalIds } from "@/lib/jobtread";
import { orderExternalId } from "@/lib/amazonImport";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only idempotency pre-check for the Amazon import. Given the vendor and a
 * batch of Amazon Order IDs, returns which orders are ALREADY in JobTread (a bill
 * with externalId AMZ-<OrderID> exists on that vendor). The page uses this to
 * grey-out and deselect already-ingested orders the moment a report is uploaded,
 * so the office never re-creates them. (The POST create path still fails closed
 * per-order via findBillByExternalId — this is the friendly, up-front version.)
 *
 * POST { vendorId, orderIds[] } → { existing: string[] }  (the subset of orderIds)
 */
const MAX_ORDERS = 400;

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  let body: { vendorId?: string; orderIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const vendorId = String(body.vendorId ?? "").trim();
  const orderIds = [
    ...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map((s) => String(s).trim()).filter(Boolean)),
  ];
  if (!vendorId) return NextResponse.json({ existing: [] });
  if (orderIds.length === 0) return NextResponse.json({ existing: [] });
  if (orderIds.length > MAX_ORDERS) {
    return NextResponse.json({ error: `Too many orders (max ${MAX_ORDERS}).` }, { status: 400 });
  }

  // Map each externalId back to its Order ID so the client can key by orderId.
  const extToOrder = new Map<string, string>();
  for (const id of orderIds) extToOrder.set(orderExternalId(id), id);

  try {
    const foundExt = await findExistingExternalIds(getPaveConfig(), vendorId, [...extToOrder.keys()]);
    const existing = foundExt.map((e) => extToOrder.get(e)).filter((x): x is string => Boolean(x));
    return NextResponse.json({ existing });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Idempotency check failed." },
      { status: 502 },
    );
  }
}
