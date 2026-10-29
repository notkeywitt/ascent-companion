/**
 * A PLACE IN PLAIN WORDS — the From and To fields of a hand-entered trip.
 *
 * A driver types "Office", "the shop" or "Berger" instead of a street address.
 * `resolvePlace` matches that text against the open jobs and returns the job's
 * JobTread address, which is what Google routes. Office and Shop are ordinary
 * JobTread jobs under the "Ascent" customer, so they need no special case.
 *
 * Text that names no job comes back as `none`, and the page sends it to Google
 * unchanged — a typed street address still works. Text that fits more than one
 * job comes back as `ambiguous`, so the page can ask instead of guessing.
 *
 * Pure: the page passes in the job list it already holds.
 */

export interface PlaceJob {
  id: string;
  name: string;
  number?: string;
  customer?: string;
  address?: string;
}

export type PlaceMatch =
  /** No job fits; treat the text as an address. */
  | { kind: "none" }
  /** One job fits. `address` is "" when the job has none in JobTread. */
  | { kind: "job"; job: PlaceJob; address: string }
  /** Several jobs fit; the driver must say which. */
  | { kind: "ambiguous"; jobs: PlaceJob[] };

// Words a person adds around a job name that are not part of it.
const FILLER = new Set(["the", "a", "at", "to", "from", "our", "job", "jobsite", "site", "s"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const norm = (text: string) => tokens(text).filter((t) => !FILLER.has(t)).join(" ");

/** The job's address as Google reads it — JobTread's ", USA" tail dropped. */
export const placeJobAddress = (j: PlaceJob) => (j.address ?? "").replace(/,\s*USA$/i, "").trim();

/** How a job reads in the From/To suggestions, and the text that resolves back to it. */
export function placeLabel(j: PlaceJob): string {
  const customer = (j.customer ?? "").trim();
  // Ascent's own jobs read as plain "Office" and "Shop".
  if (!customer || customer.toLowerCase() === "ascent") return j.name.trim();
  return `${customer} - ${j.name.trim()}`;
}

export function resolvePlace(text: string, jobs: PlaceJob[]): PlaceMatch {
  const want = tokens(text).filter((t) => !FILLER.has(t));
  if (!want.length) return { kind: "none" };
  const q = want.join(" ");

  // A job number: "#142" or "job 142". A bare number is a house number.
  const num = /^\s*(?:#|job\s*#?\s*)(\d+)\s*$/i.exec(text)?.[1];
  if (num) {
    const hits = jobs.filter((j) => String(j.number ?? "").trim() === num);
    return pick(hits);
  }

  // Every word the driver typed must appear in the job's name or customer.
  const fits = jobs.filter((j) => {
    const hay = new Set(tokens(`${j.name} ${j.customer ?? ""}`));
    return want.every((t) => hay.has(t));
  });
  if (fits.length <= 1) return pick(fits);

  // Several fit. The one whose name or full label IS the text wins — so "Office"
  // is the Office job, not every customer with "Office" in its name.
  const exact = fits.filter((j) => norm(j.name) === q || norm(placeLabel(j)) === q || norm(`${j.customer ?? ""} ${j.name}`) === q);
  if (exact.length === 1) return pick(exact);
  return { kind: "ambiguous", jobs: exact.length ? exact : fits };
}

function pick(hits: PlaceJob[]): PlaceMatch {
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous", jobs: hits };
  return { kind: "job", job: hits[0], address: placeJobAddress(hits[0]) };
}
