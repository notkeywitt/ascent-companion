import { unstable_cache } from "next/cache";
import { getPaveConfig } from "@/lib/config";
import { getJobs, getYearRibbonRows, jtIsoToOrgLocal } from "@/lib/jobtread";
import { buildRibbonJobs, type RibbonJob } from "@/lib/yearRibbon";

/**
 * Every job's ribbon series for the current year, cached for 30 minutes and
 * shared by the Home ribbon and the Jobs page ribbon. Server-only.
 *
 * The year is the ORG's, not the server's: a Vercel lambda runs in UTC and
 * would turn the year over hours early on New Year's Eve.
 */
const read = unstable_cache(
  async (year: number): Promise<RibbonJob[]> => {
    const cfg = getPaveConfig();
    const [rows, jobs] = await Promise.all([getYearRibbonRows(cfg, year), getJobs(cfg, true)]);
    // Two jobs can share a name (two clients each have a "Main House"), so a
    // repeated name carries its customer.
    const seen = new Map<string, number>();
    for (const j of jobs) seen.set(j.name, (seen.get(j.name) ?? 0) + 1);
    const names = new Map(
      jobs.map((j) => [j.id, (seen.get(j.name) ?? 0) > 1 && j.customer ? `${j.name} (${j.customer})` : j.name]),
    );
    return buildRibbonJobs(rows.minutes, rows.bills, (id) => names.get(id) ?? "Unknown job", rows.invoices);
  },
  // v2: jobs carry `invoiced` (2026-11-14). A new key drops the old shape.
  ["year-ribbon-v2"],
  { revalidate: 1800, tags: ["jt-year-ribbon"] },
);

export async function readYearRibbon(): Promise<{ year: number; today: string; jobs: RibbonJob[] }> {
  const today = jtIsoToOrgLocal(new Date().toISOString()).slice(0, 10);
  const year = Number(today.slice(0, 4));
  return { year, today, jobs: await read(year) };
}
