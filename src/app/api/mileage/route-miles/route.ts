import { NextRequest, NextResponse } from "next/server";

import { milesBetween } from "@/lib/mileageRoute";

// Driving miles between two places, for a hand-entered trip. Reads Google
// Routes only; it saves nothing. The page shows the miles in an editable field,
// and the driver's Save goes through POST /api/mileage { manual: true }.
//
//   POST { from, to }   (each place: an address, or "lat,lng")
//     → { ok, oneWayMiles, startAddress, endAddress } | { ok:false, error }
// The page doubles a round trip itself, so flipping the switch needs no re-fetch.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const from = String(body.from ?? "").trim();
  const to = String(body.to ?? "").trim();
  if (!from || !to) {
    return NextResponse.json({ ok: false, error: "Enter where you drove from and to." }, { status: 400 });
  }
  const result = await milesBetween(from, to);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
