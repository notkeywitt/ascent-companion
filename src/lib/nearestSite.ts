/**
 * The job site nearest a GPS fix. Used by the Tools page's scan (to preselect
 * "Set location to") and by Batch add (to set each new tool's Location).
 * Pure and client-safe.
 */

export interface Point {
  lat: number;
  lng: number;
}

export interface Site {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

/** Great-circle distance in km. */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Several Ascent overhead projects (Shop, Office, Electrical) share the shop's
// single address (4223 Center Rd), so GPS distance can't tell them apart. When
// the shop cluster is the nearest location we want the Shop, not whichever
// project happens to sort first — a tool at the shop lives "at the Shop".
export function isShopLabel(label: string): boolean {
  return label.trim().toLowerCase().endsWith("shop");
}

/**
 * The nearest site with coordinates, and how far it is. Sites that tie for
 * nearest (within 50 m of each other in distance) go to the Shop. Null when no
 * site has coordinates, or the nearest is farther than `maxKm`.
 */
export function nearestSite<T extends Site>(sites: T[], fix: Point, maxKm = Infinity): { site: T; km: number } | null {
  const scored = sites
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ site: p, km: haversineKm(fix, { lat: p.lat as number, lng: p.lng as number }) }))
    .sort((a, b) => a.km - b.km);
  if (!scored.length || scored[0].km > maxKm) return null;
  const EPS = 0.05; // km
  const tied = scored.filter((s) => s.km <= scored[0].km + EPS);
  return tied.find((s) => isShopLabel(s.site.label)) ?? tied[0];
}
