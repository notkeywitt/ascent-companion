import { unstable_cache } from "next/cache";

import { KNOWN_PLACES } from "@/lib/mileagePlace";
import { geocode } from "@/lib/mileageRoute";

/**
 * The crew's regular stops (`KNOWN_PLACES`) as map points, for the Miles map.
 * Google geocodes each address once; the Data Cache keeps the answer a week,
 * because the addresses only change when someone edits `KNOWN_PLACES`.
 * Server-only: reads GOOGLE_MAPS_API_KEY. A place Google cannot find is left out.
 */
export interface KnownPlacePoint {
  label: string;
  address: string;
  lat: number;
  lng: number;
}

const readPoints = unstable_cache(
  async (): Promise<KnownPlacePoint[]> => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return [];
    const pts = await Promise.all(KNOWN_PLACES.map((p) => geocode(p.address, key)));
    const found = KNOWN_PLACES.flatMap((p, i) => (pts[i] ? [{ label: p.label, address: p.address, ...pts[i]! }] : []));
    // A failed read is not cached as an answer: throw, so the next load retries.
    if (!found.length) throw new Error("no known place geocoded");
    return found;
  },
  ["mileage-known-place-points", KNOWN_PLACES.map((p) => p.address).join("|")],
  { revalidate: 7 * 24 * 3600 },
);

/** Never throws, and never holds the page past `waitMs`. */
export async function getKnownPlacePoints(waitMs = 1500): Promise<KnownPlacePoint[]> {
  const timeout = new Promise<KnownPlacePoint[]>((r) => setTimeout(() => r([]), waitMs));
  return Promise.race([readPoints().catch(() => []), timeout]);
}
