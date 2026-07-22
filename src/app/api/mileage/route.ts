import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

// Proxy to the Apps Script web app's mileage actions. The one-tap flow captures
// two GPS points + timestamps on the phone; this route turns them into an
// auditable trip: it makes a SINGLE Google Directions call (driving miles AND
// reverse-geocoded start/end addresses come back in the same leg), stamps the
// signed-in user, then forwards the finished trip to Apps Script, which appends
// one row to the Project Database "Mileage" tab. Apps Script holds the Sheets
// grant; the secret + the Maps key stay server-side.
//
// Env (secret shared with /api/email, /api/employees, /api/tool-tracker):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//   GOOGLE_MAPS_API_KEY     — a Maps Platform key restricted to the Directions API
//
//   GET  → { ok, headers, trips }                              (history view)
//   POST { startLat,startLng,startTime, endLat,endLng,endTime,
//          jobId?, jobLabel?, purpose?, driver? }              (GPS trip)
//        → { ok, tripId, miles, date, startAddress, endAddress, warning? }
//   POST { manual:true, miles, date?, jobId?, jobLabel?, purpose?, driver? }
//        → { ok, tripId, miles, date }                         (hand-entered — no GPS/Directions)
//
// Distance is the route Google would drive between the two endpoints — accurate
// for a simple A→B trip, not a traced path. If Directions is unavailable the
// trip STILL saves (miles null) with a warning, so no data is lost.
export const dynamic = "force-dynamic";

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
    // Apps Script answers via a 302 to a one-time content URL, always HTTP 200
    // there — success/failure is the `ok` field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as unknown, status: 200 };
    } catch {
      return {
        error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
        status: 502,
      };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error", status: 502 };
  }
}

interface DirectionsResult {
  miles: number | null;
  startAddress: string;
  endAddress: string;
  warning?: string;
}

// One Directions call: origin → destination. Returns driving miles plus the
// reverse-geocoded start/end addresses from the same leg. Never throws — a
// failure returns miles null + a warning so the trip can still be logged.
async function drivingDistance(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): Promise<DirectionsResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return { miles: null, startAddress: "", endAddress: "", warning: "GOOGLE_MAPS_API_KEY is not set — miles not computed." };
  }
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${dest.lat},${dest.lng}`,
    mode: "driving",
    units: "imperial",
    key,
  });
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
    const data = (await res.json()) as {
      status?: string;
      error_message?: string;
      routes?: { legs?: { distance?: { value?: number }; start_address?: string; end_address?: string }[] }[];
    };
    const leg = data.routes?.[0]?.legs?.[0];
    if (data.status !== "OK" || !leg) {
      return {
        miles: null,
        startAddress: "",
        endAddress: "",
        warning: `Directions ${data.status ?? "error"}${data.error_message ? ": " + data.error_message : ""} — trip saved without miles.`,
      };
    }
    const meters = leg.distance?.value ?? 0;
    return {
      miles: Math.round((meters / 1609.344) * 10) / 10,
      startAddress: leg.start_address ?? "",
      endAddress: leg.end_address ?? "",
    };
  } catch (e) {
    return {
      miles: null,
      startAddress: "",
      endAddress: "",
      warning: `Directions request failed (${e instanceof Error ? e.message : "unknown"}) — trip saved without miles.`,
    };
  }
}

export async function GET() {
  const result = await callAppsScript({ action: "listMileage" });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 200 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // Attribute the trip to the signed-in user, not to anything the client sends.
  const session = await auth();
  const loggedBy = session?.user?.email ?? "";

  // Manual entry: miles typed by hand, no GPS — no Directions call, just log it.
  if (body.manual === true) {
    const miles = Number(body.miles);
    if (!Number.isFinite(miles) || miles <= 0) {
      return NextResponse.json({ error: "Enter the miles driven (greater than 0)." }, { status: 400 });
    }
    const manual = await callAppsScript({
      action: "logMileage",
      manual: true,
      miles,
      date: body.date ?? "",
      driver: body.driver ?? "",
      loggedBy,
      jobId: body.jobId ?? "",
      jobLabel: body.jobLabel ?? "",
      purpose: body.purpose ?? "",
    });
    if (manual.error) return NextResponse.json({ error: manual.error }, { status: manual.status });
    return NextResponse.json(manual.data, { status: 200 });
  }

  const startLat = Number(body.startLat);
  const startLng = Number(body.startLng);
  const endLat = Number(body.endLat);
  const endLng = Number(body.endLng);
  if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) {
    return NextResponse.json({ error: "Valid start/end coordinates are required." }, { status: 400 });
  }

  const dir = await drivingDistance({ lat: startLat, lng: startLng }, { lat: endLat, lng: endLng });

  const result = await callAppsScript({
    action: "logMileage",
    driver: body.driver ?? "",
    loggedBy,
    jobId: body.jobId ?? "",
    jobLabel: body.jobLabel ?? "",
    purpose: body.purpose ?? "",
    startTime: body.startTime ?? "",
    endTime: body.endTime ?? "",
    startLat,
    startLng,
    endLat,
    endLng,
    startAddress: dir.startAddress,
    endAddress: dir.endAddress,
    miles: dir.miles,
    distanceSource: dir.miles == null ? "unavailable" : "google_directions",
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  // Merge the computed address/miles + any Directions warning into the reply so
  // the summary screen can show them without a second round-trip.
  const data = (result.data ?? {}) as Record<string, unknown>;
  return NextResponse.json(
    { ...data, startAddress: dir.startAddress, endAddress: dir.endAddress, warning: dir.warning },
    { status: 200 },
  );
}
