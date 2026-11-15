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
