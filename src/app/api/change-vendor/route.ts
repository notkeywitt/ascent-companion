import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches } from "@/lib/jobtread";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig } from "@/lib/config";
import { qboLock } from "@/lib/qboLock";

// "Change vendor" on a draft bill. JobTread can't change a bill's vendor, so
// Apps Script (action "changeVendor") VOIDS the old bill (status denied, never
// deleted) and recreates it under the new vendor on the same job, the same way
// /api/reassign-job moves a bill to another job. Runs inline, so allow the long
// function timeout.
//
// POST /api/change-vendor { docId, accountId } →
//   { ok, newDocId, vendorId, vendor, expId } | { ok:false, error } | { error }
//   accountId = the new vendor's JobTread account id (from /api/vendors).
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const docId = String(body.docId ?? "").trim();
  const accountId = String(body.accountId ?? "").trim();
  if (!docId || !accountId) {
    return NextResponse.json({ error: "docId and accountId are required." }, { status: 400 });
  }

  // The void+recreate must not touch a bill already in QuickBooks.
  const locked = await qboLock(getPaveConfig(), { docId });
  if (locked) return locked;

  // A write: never retried.
  const res = await callAppsScript({ action: "changeVendor", docId, accountId }, { timeoutMs: 110_000 });
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });

  clearJobCostCaches();
  return NextResponse.json(res.data, { status: 200 });
}
