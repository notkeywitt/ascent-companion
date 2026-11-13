import { billingMonths } from "@/lib/billingMonths";

/**
 * Jobs Hub direct links: /jobs-hub/<job>/<Month>[-<year>]/<billId>.
 * Job = the customer's last word ("Ferron"), or the full label when two jobs share
 * it. Month = its name; the year shows only when it is not the latest such month.
 */
type J = { id: string; name: string; customer?: string | null };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fullSlug = (j: J) => slug(`${j.customer ?? ""} ${j.name}`);
const shortSlug = (j: J) => slug((j.customer ?? "").trim().split(/\s+/).pop() ?? "") || fullSlug(j);

export function jobSlug(j: J, all: J[]): string {
  const s = shortSlug(j);
  return all.filter((x) => shortSlug(x) === s).length > 1 ? fullSlug(j) : s;
}

export function monthSlug(ym: string): string {
  const [y, m] = ym.split("-");
  const label = billingMonths().find((x) => x.value === ym)?.label ?? "";
  const name = label.split(" ")[0];
  if (!name) return ym;
  const latest = billingMonths().find((x) => x.value.endsWith(`-${m}`));
  return latest?.value === ym ? name : `${name}-${y}`;
}

export function hubPath(job: J | null, all: J[], ym: string, docId?: string | null): string {
  if (!job) return "/jobs-hub";
  return ["/jobs-hub", jobSlug(job, all), ym && monthSlug(ym), job && docId].filter(Boolean).join("/");
}

/**
 * A link to one job on the Jobs Hub by id, for callers without the job list
 * (`hubPath` needs it). The hub reads the query once, opens the job's Tracking
 * sheet tab, then rewrites the address to the short path. `extra` carries a
 * board focus (findingFocus.ts). Replaces /trackingsheet?jobId= (OVERHAUL_PLAN 3.3).
 */
export function hubHref(jobId: string, ym?: string | null, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ jobId, ...(ym ? { ym } : {}), ...extra });
  return `/jobs-hub?${q.toString()}`;
}

/** The path's job id, ym and bill id; each undefined when absent or unknown. */
export function parseHubPath(pathname: string, all: J[]) {
  const [, , jobSeg, monthSeg, docId] = pathname.split("/").map((s) => decodeURIComponent(s));
  const seg = slug(jobSeg ?? "");
  const job = seg ? (all.find((j) => fullSlug(j) === seg) ?? all.find((j) => shortSlug(j) === seg)) : undefined;
  let ym: string | undefined;
  if (monthSeg) {
    if (/^\d{4}-\d{2}$/.test(monthSeg)) ym = monthSeg;
    else {
      const [name, year] = monthSeg.split("-");
      ym = billingMonths().find(
        (m) => m.label.toLowerCase().startsWith(name.toLowerCase()) && (!year || m.value.startsWith(year)),
      )?.value;
    }
  }
  return { jobId: job?.id, ym, docId };
}
