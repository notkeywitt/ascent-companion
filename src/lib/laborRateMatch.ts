/**
 * The job labor-rate map's rules (pure, so the browser runs them too).
 * Each job pays each cost code at one pay type. A time entry that carries a
 * different type is a mismatch; a job + code pair with no map row is
 * unmapped, and its types in use are offered as map rows.
 */

export interface JobCodeRate {
  jobId: string;
  jobName: string;
  costCode: string;
  payType: string;
}

export interface RateEntry {
  id: string;
  date: string;
  employee: string;
  userId: string;
  jobId: string;
  jobName: string;
  code: string;
  type: string;
  hours: number;
}

export interface RateMismatch {
  entry: RateEntry;
  /** The pay type the map says this job + code is paid at. */
  expected: string;
}

export interface UnmappedPair {
  jobId: string;
  jobName: string;
  costCode: string;
  /** The pay types in use on the pair, most used first. */
  types: { payType: string; count: number }[];
}

/** One Labor Rates Map row: what a job pays a cost code per hour. */
export interface CodeRate {
  jobId: string;
  costCode: string;
  hourlyRate: number;
}

export interface RateChange {
  /** The map's rate for the entry's job + code. */
  rate: number;
  /** The employee's pay type at that rate, or null when they hold none. */
  type: string | null;
}

/**
 * The entries the Labor Rates Map would re-rate, by entry id. An entry's rate
 * is its pay type's, so the fix is the employee's pay type whose hourly rate
 * equals the map's (first held wins). `type` null = no such pay type to assign.
 */
export function rateChanges(
  entries: { id: string; userId: string; jobId: string; code: string; hourlyRate: number }[],
  map: CodeRate[],
  members: { userId: string; types: { name: string; hourlyRate: number }[] }[],
): Map<string, RateChange> {
  const by = new Map(map.map((r) => [`${r.jobId}|${r.costCode}`, r.hourlyRate]));
  const out = new Map<string, RateChange>();
  for (const e of entries) {
    const rate = by.get(`${e.jobId}|${e.code}`);
    if (rate === undefined || Math.abs(e.hourlyRate - rate) < 0.005) continue;
    const type = members.find((m) => m.userId === e.userId)?.types.find((t) => Math.abs(t.hourlyRate - rate) < 0.005);
    out.set(e.id, { rate, type: type?.name ?? null });
  }
  return out;
}

const key = (jobId: string, code: string) => `${jobId}|${code}`;

export function findMismatches(entries: RateEntry[], map: JobCodeRate[]): RateMismatch[] {
  const by = new Map(map.map((r) => [key(r.jobId, r.costCode), r.payType]));
  const out: RateMismatch[] = [];
  for (const entry of entries) {
    const expected = by.get(key(entry.jobId, entry.code));
    if (expected && entry.type !== expected) out.push({ entry, expected });
  }
  return out;
}

export function unmappedPairs(entries: RateEntry[], map: JobCodeRate[]): UnmappedPair[] {
  const mapped = new Set(map.map((r) => key(r.jobId, r.costCode)));
  const pairs = new Map<string, UnmappedPair & { n: Map<string, number> }>();
  for (const e of entries) {
    if (!e.jobId || !e.code || !e.type || mapped.has(key(e.jobId, e.code))) continue;
    const p = pairs.get(key(e.jobId, e.code)) ?? {
      jobId: e.jobId,
      jobName: e.jobName,
      costCode: e.code,
      types: [],
      n: new Map<string, number>(),
    };
    p.n.set(e.type, (p.n.get(e.type) ?? 0) + 1);
    pairs.set(key(e.jobId, e.code), p);
  }
  return [...pairs.values()]
    .map(({ n, ...p }) => ({
      ...p,
      types: [...n.entries()].map(([payType, count]) => ({ payType, count })).sort((a, b) => b.count - a.count),
    }))
    .sort(
      (a, b) =>
        a.jobName.localeCompare(b.jobName) || a.costCode.localeCompare(b.costCode, undefined, { numeric: true }),
    );
}
