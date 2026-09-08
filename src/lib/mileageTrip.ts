/**
 * THE OPEN TRIP — a started-but-not-yet-ended mileage trip, kept where a closed
 * app cannot lose it.
 *
 * THE PROBLEM. A browser cannot follow a phone down the road: once the screen
 * locks or the app is closed, the page is suspended and any GPS watch stops. The
 * tracker was already built for that — it takes a START point on the first tap
 * and an END point on the second, and Google Routes turns the two into driving
 * miles. But the started trip lived in ONE place, `localStorage` on the phone
 * that tapped Start. Anything that emptied that store, or a driver who tapped
 * Start in Safari and reopened the installed app, came back to an empty screen
 * and a drive with no miles.
 *
 * TWO LAYERS, same doctrine as `codingDraft.ts`:
 *
 *   1. localStorage, written on every change. Synchronous and offline — this is
 *      the copy that survives a force-quit in a canyon with no signal.
 *   2. The companion DB (`/api/mileage/active`), pushed best-effort behind it.
 *      This is what survives a cleared browser, and what lets the driver end the
 *      trip from a different device than the one that started it.
 *
 * The server copy is a BACKUP. On reopen the client takes whichever copy carries
 * the LATER start, and local wins a tie — local is never behind for the device
 * that is holding it.
 *
 * One open trip per person. Tapping Start again replaces it, which is what
 * "start a trip" means to a driver.
 */

/** A point along the route: a marked stop, or an auto-tracked breadcrumb. */
export interface TripPoint {
  lat: number;
  lng: number;
  time: string; // ISO
}

/** Everything needed to finish a trip that was started somewhere else. */
export interface ActiveTrip {
  /** Idempotency key for the finished trip — the server dedupes a retried save. */
  tripKey: string;
  startLat: number;
  startLng: number;
  startTime: string; // ISO
  driver: string;
  jobId: string;
  jobLabel: string;
  purpose: string;
  /** Stops the driver marked by hand. */
  waypoints: TripPoint[];
  /** Auto-tracked breadcrumbs, recorded while the app was open. */
  trail: TripPoint[];
  /** ISO time of the last change, for the "started on another device" line. */
  savedAt: string;
}

export const LS_TRIP = "mileage.activeTrip";

/** How long the server keeps an open trip nobody ended before sweeping it. */
export const OPEN_TRIP_TTL_DAYS = 7;

/** Past this, a restored trip is old enough that the driver is warned about it. */
export const STALE_TRIP_HOURS = 12;

/**
 * How many trail points the SERVER copy keeps. The trail only shapes the route,
 * and the Routes API takes at most 25 intermediates anyway — so a bounded sample
 * is a complete backup, and it stops a long drive growing an unbounded row.
 */
const SERVER_TRAIL_CAP = 200;

/** Evenly reduce an ordered list to at most `max` items, keeping first and last. */
export function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

function isPoint(p: unknown): p is TripPoint {
  const o = p as TripPoint | undefined;
  return !!o && Number.isFinite(o.lat) && Number.isFinite(o.lng);
}

function points(v: unknown): TripPoint[] {
  return Array.isArray(v) ? v.filter(isPoint).map((p) => ({ lat: p.lat, lng: p.lng, time: String(p.time ?? "") })) : [];
}

/**
 * Read an unknown shape as an ActiveTrip, or null. Used on both sides: the page
 * reads localStorage with it, the route reads the request body with it — so a
 * trip written by an older build restores instead of throwing.
 */
export function parseTrip(v: unknown): ActiveTrip | null {
  const t = v as Record<string, unknown> | null;
  if (!t || typeof t !== "object") return null;
  const startLat = Number(t.startLat);
  const startLng = Number(t.startLng);
  const startTime = String(t.startTime ?? "");
  if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) return null;
  if (!startTime || Number.isNaN(Date.parse(startTime))) return null;
  return {
    tripKey: String(t.tripKey ?? ""),
    startLat,
    startLng,
    startTime,
    driver: String(t.driver ?? ""),
    jobId: String(t.jobId ?? ""),
    jobLabel: String(t.jobLabel ?? ""),
    purpose: String(t.purpose ?? ""),
    waypoints: points(t.waypoints),
    trail: points(t.trail),
    savedAt: String(t.savedAt ?? startTime),
  };
}

/** The copy to restore from: the later start, and local wins a tie. */
export function pickTrip(local: ActiveTrip | null, server: ActiveTrip | null): ActiveTrip | null {
  if (!local) return server;
  if (!server) return local;
  return Date.parse(server.startTime) > Date.parse(local.startTime) ? server : local;
}

/** True when a restored trip is old enough that the driver probably forgot it. */
export function isStale(startTime: string, now = Date.now()): boolean {
  const t = Date.parse(startTime);
  return Number.isFinite(t) && now - t > STALE_TRIP_HOURS * 3_600_000;
}

// ---------------------------------------------------------------- local copy

export function readLocalTrip(): ActiveTrip | null {
  try {
    const raw = localStorage.getItem(LS_TRIP);
    return raw ? parseTrip(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeLocalTrip(trip: ActiveTrip): void {
  try {
    localStorage.setItem(LS_TRIP, JSON.stringify(trip));
  } catch {}
}

export function clearLocalTrip(): void {
  try {
    localStorage.removeItem(LS_TRIP);
  } catch {}
}

// --------------------------------------------------------------- server copy

/** The bounded copy that goes to the server — full trip, sampled trail. */
function forServer(trip: ActiveTrip): ActiveTrip {
  return { ...trip, trail: downsample(trip.trail, SERVER_TRAIL_CAP) };
}

/**
 * Mirror the open trip to the companion DB. Best-effort: a failure is swallowed,
 * because the local copy is the one that must not be waited on.
 *
 * `beacon` is for the moment the app is being backgrounded — `sendBeacon` hands
 * the request to the browser, which delivers it after the page is suspended. A
 * normal fetch there is cancelled mid-flight.
 */
export async function pushTrip(trip: ActiveTrip, opts: { beacon?: boolean } = {}): Promise<void> {
  const body = JSON.stringify({ trip: forServer(trip) });
  if (opts.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon("/api/mileage/active", new Blob([body], { type: "application/json" }))) return;
    } catch {}
  }
  try {
    await fetch("/api/mileage/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {}
}

/** The open trip the server holds for the signed-in user, if any. */
export async function fetchServerTrip(): Promise<ActiveTrip | null> {
  try {
    const res = await fetch("/api/mileage/active");
    if (!res.ok) return null;
    const json = (await res.json()) as { trip?: unknown };
    return parseTrip(json.trip);
  } catch {
    return null;
  }
}

/** Drop the server's open trip — the trip ended, or the driver cancelled it. */
export async function clearServerTrip(): Promise<void> {
  try {
    await fetch("/api/mileage/active", { method: "DELETE", keepalive: true });
  } catch {}
}
