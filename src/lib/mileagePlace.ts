/**
 * A PLACE IN PLAIN WORDS — the From and To fields of a hand-entered trip.
 *
 * A driver types "Office", "the shop", "Berger" or "the dump" instead of a
 * street address. `resolvePlace` matches that text against the open jobs and
 * the crew's regular stops (`KNOWN_PLACES`), and returns an address for Google
 * to route. Office and Shop are ordinary JobTread jobs under the "Ascent"
 * customer, so they need no special case. A job's address comes from JobTread.
 *
 * Text that names no job or place comes back as `none`, and the page sends it to Google
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

/**
 * The crew's regular stops that are not jobs. Add one here: a label, the words
 * people call it, and a street address Google can route. Found 2026-10-29 on
 * each business's own listing; JobTread's vendor records carry no address.
 */
export interface KnownPlace {
  label: string;
  aliases: string[];
  address: string;
}

export const KNOWN_PLACES: KnownPlace[] = [
  {
    label: "Sunset Builders Supply",
    aliases: ["sunset", "sunset builders", "sunset builders supply", "the lumber yard", "lumber yard"],
    address: "4194 Center Rd, Lopez Island, WA 98261",
  },
  {
    label: "Blossom Grocery",
    aliases: ["blossom", "blossom grocery", "blossoms"],
    address: "295 Village Rd, Lopez Island, WA 98261",
  },
  {
    label: "Lopez Village Market",
    aliases: ["lvm", "lopez village market", "village market", "red apple"],
    address: "162 Weeks Rd, Lopez Island, WA 98261",
  },
  {
    label: "Lopez Dump",
    aliases: ["dump", "the dump", "lopez dump", "transfer station", "solid waste", "lopez solid waste", "recycle center"],
    address: "2419 Fisherman Bay Rd, Lopez Island, WA 98261",
  },
];

export type PlaceMatch =
  /** Nothing fits; treat the text as an address. */
  | { kind: "none" }
  /**
   * One job or one known place fits. `job` is set for a job. `address` is ""
   * when the job has none in JobTread.
   */
  | { kind: "named"; label: string; address: string; job?: PlaceJob }
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

  // A known place called by one of its names wins outright: "the dump", "LVM".
  const known = KNOWN_PLACES.find((p) => [p.label, ...p.aliases].some((a) => norm(a) === q));
  if (known) return named(known);

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
  if (fits.length === 0) {
    // No job — try the known places' words: "sunset supply", "village grocery".
    const places = KNOWN_PLACES.filter((p) => {
      const hay = new Set(tokens([p.label, ...p.aliases].join(" ")));
      return want.every((t) => hay.has(t));
    });
    return places.length === 1 ? named(places[0]) : { kind: "none" };
  }
  if (fits.length === 1) return pick(fits);

  // Several fit. The one whose name or full label IS the text wins — so "Office"
  // is the Office job, not every customer with "Office" in its name.
  const exact = fits.filter((j) => norm(j.name) === q || norm(placeLabel(j)) === q || norm(`${j.customer ?? ""} ${j.name}`) === q);
  if (exact.length === 1) return pick(exact);
  return { kind: "ambiguous", jobs: exact.length ? exact : fits };
}

function pick(hits: PlaceJob[]): PlaceMatch {
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous", jobs: hits };
  return { kind: "named", label: placeLabel(hits[0]), address: placeJobAddress(hits[0]), job: hits[0] };
}

const named = (p: KnownPlace): PlaceMatch => ({ kind: "named", label: p.label, address: p.address });

export interface PlaceSuggestion {
  /** The text the field takes when the driver picks it; it resolves back here. */
  label: string;
  /** Shown under the label so the driver can tell two jobs apart. */
  address: string;
  kind: "place" | "job";
}

/**
 * The list under a From/To field while the driver types. Every typed word must
 * START a word of the place: "sun" finds Sunset, "berg ma" finds Berger - Main
 * House. A place whose name starts with the text comes first, then the known
 * places, then by name. Empty text suggests nothing.
 */
export function suggestPlaces(text: string, jobs: PlaceJob[], limit = 8): PlaceSuggestion[] {
  const want = tokens(text).filter((t) => !FILLER.has(t));
  if (!want.length) return [];
  const q = want.join(" ");

  const candidates = [
    ...KNOWN_PLACES.map((p) => ({ label: p.label, address: p.address, kind: "place" as const, names: [p.label, ...p.aliases] })),
    ...jobs.map((j) => ({
      label: placeLabel(j),
      address: placeJobAddress(j),
      kind: "job" as const,
      names: [placeLabel(j), j.name, `${j.name} ${j.customer ?? ""} ${j.number ?? ""}`],
    })),
  ];

  const seen = new Set<string>();
  const out: (PlaceSuggestion & { rank: number })[] = [];
  for (const c of candidates) {
    if (seen.has(c.label)) continue;
    const hay = tokens(c.names.join(" "));
    if (!want.every((w) => hay.some((h) => h.startsWith(w)))) continue;
    seen.add(c.label);
    const starts = c.names.some((n) => norm(n).startsWith(q));
    out.push({ label: c.label, address: c.address, kind: c.kind, rank: (starts ? 0 : 2) + (c.kind === "place" ? 0 : 1) });
  }
  return out
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ label, address, kind }) => ({ label, address, kind }));
}
