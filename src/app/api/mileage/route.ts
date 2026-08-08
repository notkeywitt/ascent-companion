import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { callAppsScript } from "@/lib/appsScript";

// Proxy to the Apps Script web app's mileage actions. The one-tap flow captures
// two GPS points + timestamps on the phone; this route turns them into an
// auditable trip: it calls the Routes API for driving miles (+ a best-effort
// reverse geocode for the start/end addresses), stamps the signed-in user, then
// forwards the finished trip to Apps Script, which appends one row to the
// Project Database "Mileage" tab. Apps Script holds the Sheets grant; the secret
// + the Maps key stay server-side.
//
// Env (secret shared with /api/email, /api/employees, /api/tool-tracker):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//   GOOGLE_MAPS_API_KEY     — Maps Platform key; enable the Routes API (miles)
//                             and, for addresses, the Geocoding API
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

type LatLng = { lat: number; lng: number };

interface DirectionsResult {
  miles: number | null;
  startAddress: string;
  endAddress: string;
  via: string; // intermediate stop addresses joined " → " (best-effort)
  polyline: string; // encoded route geometry for the static map
  warning?: string;
}

// Driving distance via the Routes API (the legacy Directions API is being
// retired and most projects can no longer enable it). Street addresses come
// from a best-effort reverse geocode (Geocoding API), so the miles still work
// even if only the Routes API is enabled. Never throws — on failure it returns
// miles null + a warning so the trip is still logged.
async function drivingDistance(
  origin: LatLng,
  dest: LatLng,
  intermediates: LatLng[] = [],
  stopsForVia: LatLng[] = [],
): Promise<DirectionsResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return { miles: null, startAddress: "", endAddress: "", via: "", polyline: "", warning: "GOOGLE_MAPS_API_KEY is not set — miles not computed." };
  }

  // Addresses are optional; fetch start/end + the driver's MARKED stops (not the
  // auto-tracked breadcrumbs) alongside the distance, and never let them block
  // the result.
  const [startAddress, endAddress, ...viaAddrs] = await Promise.all([
    reverseGeocode(origin, key),
    reverseGeocode(dest, key),
    ...stopsForVia.map((p) => reverseGeocode(p, key)),
  ]);
  const via = viaAddrs.filter(Boolean).join(" → ");

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
        // Stops the driver marked along the way — the route (and its total
        // distance) runs origin → stop → … → destination as one trip.
        intermediates: intermediates.map((p) => ({
          location: { latLng: { latitude: p.lat, longitude: p.lng } },
        })),
        travelMode: "DRIVE",
      }),
    });
    const data = (await res.json()) as {
      routes?: { distanceMeters?: number; polyline?: { encodedPolyline?: string } }[];
      error?: { message?: string; status?: string };
    };
    if (data.error || !data.routes?.[0]) {
      const msg = data.error?.message || data.error?.status || "no route found";
      return { miles: null, startAddress, endAddress, via, polyline: "", warning: `Routes API: ${msg} — trip saved without miles.` };
    }
    const meters = data.routes[0].distanceMeters ?? 0;
    const polyline = data.routes[0].polyline?.encodedPolyline ?? "";
    return { miles: Math.round((meters / 1609.344) * 10) / 10, startAddress, endAddress, via, polyline };
  } catch (e) {
    return {
      miles: null,
      startAddress,
      endAddress,
      via,
      polyline: "",
      warning: `Routes request failed (${e instanceof Error ? e.message : "unknown"}) — trip saved without miles.`,
    };
  }
}

// Reverse-geocode a lat/lng to a street address (Geocoding API). Best-effort:
// returns "" on any failure (e.g. the Geocoding API isn't enabled), so a missing
// address never blocks the trip or its miles.
async function reverseGeocode(pt: { lat: number; lng: number }, key: string): Promise<string> {
  try {
    const params = new URLSearchParams({ latlng: `${pt.lat},${pt.lng}`, key });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    const data = (await res.json()) as { status?: string; results?: { formatted_address?: string }[] };
    const addr = data.status === "OK" ? data.results?.[0]?.formatted_address : "";
    return (addr || "").replace(/,\s*USA$/i, "").trim();
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  // The requester's identity is taken from the session server-side; Apps Script
  // uses it to decide admin (all trips) vs. own-trips-only. The client cannot
  // spoof it. Filters are honored for admins (and month for everyone).
  const session = await auth();
  const requesterEmail = session?.user?.email ?? "";
  const month = req.nextUrl.searchParams.get("month") ?? "";
  const user = req.nextUrl.searchParams.get("user") ?? "";

  const result = await callAppsScript({ action: "listMileage", requesterEmail, month, user });
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

  // Route-shaping points in travel order — the driver's marked stops plus any
  // auto-tracked trail breadcrumbs (already downsampled by the client to fit the
  // Routes API's intermediate cap). Keep only valid coordinates.
  const waypoints: LatLng[] = (Array.isArray(body.waypoints) ? body.waypoints : [])
    .map((w) => ({ lat: Number((w as Record<string, unknown>)?.lat), lng: Number((w as Record<string, unknown>)?.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  // "Stops" (stored) = the meaningful stops the driver marked, sent explicitly;
  // the trail breadcrumbs shape the route but aren't counted as stops.
  const stopsRaw = Number(body.stops);
  const stops = Number.isFinite(stopsRaw) ? stopsRaw : waypoints.length;

  // Only the marked stops get reverse-geocoded for the "Via" text (not every
  // auto-tracked breadcrumb).
  const stopPoints: LatLng[] = (Array.isArray(body.stopPoints) ? body.stopPoints : [])
    .map((w) => ({ lat: Number((w as Record<string, unknown>)?.lat), lng: Number((w as Record<string, unknown>)?.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const dir = await drivingDistance({ lat: startLat, lng: startLng }, { lat: endLat, lng: endLng }, waypoints, stopPoints);

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
    distanceSource: dir.miles == null ? "unavailable" : "google_routes",
    stops,
    via: dir.via,
    polyline: dir.polyline,
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  // Merge the computed address/miles/stops + any warning into the reply so the
  // summary screen can show them (and its map) without a second round-trip.
  const data = (result.data ?? {}) as Record<string, unknown>;
  return NextResponse.json(
    {
      ...data,
      startAddress: dir.startAddress,
      endAddress: dir.endAddress,
      via: dir.via,
      stops,
      polyline: dir.polyline,
      warning: dir.warning,
    },
    { status: 200 },
  );
}
