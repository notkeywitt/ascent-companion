/**
 * MILES FROM TWO PLACES — the server-side half of a hand-entered trip.
 *
 * A trip logged after the fact has no GPS taps. The driver names where they
 * went FROM and TO (typed addresses, the job's address, or "here" as a
 * `lat,lng`), and Google Routes turns the two into driving miles. A round trip
 * is the one-way route doubled — the drive back is assumed to be the same road.
 *
 * `milesBetween` and `reverseGeocode` are server-only: they read
 * GOOGLE_MAPS_API_KEY. `tripMiles` is pure, and the page uses it. The GPS tracker in
 * `/api/mileage` shares `reverseGeocode` from here.
 */

const LATLNG_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** `lat,lng` text as a point, or null when the text is an address. */
export function parseLatLng(place: string): { lat: number; lng: number } | null {
  const m = LATLNG_RE.exec(place);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** A Routes API waypoint: coordinates when the text is `lat,lng`, else an address. */
export function routeWaypoint(place: string) {
  const pt = parseLatLng(place);
  return pt ? { location: { latLng: { latitude: pt.lat, longitude: pt.lng } } } : { address: place.trim() };
}

/** Route meters → miles, to one decimal. */
export function metersToMiles(meters: number): number {
  return Math.round((meters / 1609.344) * 10) / 10;
}

/** The miles a trip logs: the one-way route, doubled for a round trip. */
export function tripMiles(oneWayMiles: number, roundTrip: boolean): number {
  return Math.round(oneWayMiles * (roundTrip ? 2 : 1) * 10) / 10;
}

// Reverse-geocode a lat/lng to a street address (Geocoding API). Best-effort:
// returns "" on any failure (e.g. the Geocoding API isn't enabled), so a missing
// address never blocks the trip or its miles.
export async function reverseGeocode(pt: { lat: number; lng: number }, key: string): Promise<string> {
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

export type RouteMilesResult =
  | { ok: true; oneWayMiles: number; startAddress: string; endAddress: string }
  | { ok: false; error: string };

/**
 * One-way driving miles between two places. Never throws. A `lat,lng` endpoint is
 * reverse-geocoded so the saved trip reads as a street address.
 */
export async function milesBetween(from: string, to: string): Promise<RouteMilesResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, error: "GOOGLE_MAPS_API_KEY is not set — type the miles instead." };

  const fromPt = parseLatLng(from);
  const toPt = parseLatLng(to);
  const [startAddress, endAddress] = await Promise.all([
    fromPt ? reverseGeocode(fromPt, key) : Promise.resolve(from.trim()),
    toPt ? reverseGeocode(toPt, key) : Promise.resolve(to.trim()),
  ]);

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({ origin: routeWaypoint(from), destination: routeWaypoint(to), travelMode: "DRIVE" }),
    });
    const data = (await res.json()) as {
      routes?: { distanceMeters?: number }[];
      error?: { message?: string; status?: string };
    };
    const meters = data.routes?.[0]?.distanceMeters;
    if (data.error || meters == null) {
      return { ok: false, error: "Google found no driving route between those two places. Check them, or type the miles." };
    }
    return { ok: true, oneWayMiles: metersToMiles(meters), startAddress, endAddress };
  } catch (e) {
    return { ok: false, error: `Route lookup failed (${e instanceof Error ? e.message : "unknown"}) — type the miles instead.` };
  }
}
