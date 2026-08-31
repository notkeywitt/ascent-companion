/**
 * Check "cost-vs-invoice" (Billing) — jobs where what we've SPENT has outrun
 * what the client has been BILLED.
 *
 * THE MATH is the same one the /unbilled page shows, so the digest and that
 * page can never disagree: Σ approved vendorBill cost − Σ approved
 * customerInvoice cost, per job, from JobTread's own document rollup
 * (`getJobDocumentRollup` + `computeUnbilled`). Draft invoices are deliberately
 * excluded from the credit side — an invoice nobody approved has not billed
 * anybody — but a job's draft invoice total is mentioned in the detail so
 * "it's already staged" is visible rather than looking like a surprise.
 *
 * "LARGE AND UNEXPECTED" is two settings, not a judgment in code:
 *   • `gapThreshold` — how many dollars of unbilled cost is worth a mention, and
 *   • `excludeJobIds` / `excludeJobNames` — the jobs where a gap is KNOWN and
 *     accepted, e.g. jobs that were nearly finished when JobTread adoption
 *     began and were never reconciled historically. That list is DATA in
 *     settings.ts because it changes; it is never a job name buried in code.
 *
 * COST CONTROL: one rollup query per open job, run `concurrency` at a time and
 * capped at `maxJobs`. A job whose rollup fails is skipped and logged — one bad
 * job must not cost the whole check.
 *
 * READ-ONLY throughout.
 */
import { computeUnbilled, getJobDocumentRollup, getJobs, type JobRef } from "@/lib/jobtread";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { CostVsInvoiceConfig } from "../settings";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Whether a job is on the "gap is known and accepted" list. */
export function isExcludedJob(job: JobRef, config: CostVsInvoiceConfig): boolean {
  if (config.excludeJobIds.includes(job.id)) return true;
  const hay = `${job.name ?? ""} ${job.customer ?? ""}`.toLowerCase();
  return config.excludeJobNames.some((n) => {
    const needle = n.toLowerCase().trim();
    return needle.length > 0 && hay.includes(needle);
  });
}

/** Run `worker` over `items`, at most `limit` at a time, preserving nothing. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const r = await worker(items[i]);
      if (r !== null) out.push(r);
    }
  });
  await Promise.all(runners);
  return out;
}

export const costVsInvoiceCheck = defineCheck<CostVsInvoiceConfig>({
  id: "cost-vs-invoice",
  title: "Cost vs. Client Invoices",
  category: "billing",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as CostVsInvoiceConfig,

  async run({ config, pave, log }): Promise<CheckResult> {
    if (!pave?.grantKey) return checkError("JobTread isn't configured, so job costs can't be read.");

    let jobs: JobRef[];
    try {
      jobs = await getJobs(pave); // open jobs only
    } catch (e) {
      return checkError(`Couldn't read the job list: ${e instanceof Error ? e.message : String(e)}`);
    }

    const excluded = jobs.filter((j) => isExcludedJob(j, config));
    const considered = jobs.filter((j) => !isExcludedJob(j, config)).slice(0, config.maxJobs);
    if (excluded.length) log(`${excluded.length} job(s) skipped by the accepted-gap exclusion list`);
    if (jobs.length - excluded.length > config.maxJobs) {
      log(`job cap (${config.maxJobs}) reached — ${jobs.length - excluded.length - config.maxJobs} open job(s) not priced`);
    }
    log(`pricing ${considered.length} open job(s) at ${config.concurrency} at a time`);

    let failed = 0;
    const priced = await mapWithLimit(considered, config.concurrency, async (job) => {
      try {
        const rollup = await getJobDocumentRollup(pave, job.id);
        return { job, ...computeUnbilled(rollup) };
      } catch (e) {
        failed++;
        log(`couldn't price ${job.name}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    });
    if (failed) log(`${failed} job(s) failed to price and were skipped`);
    if (priced.length === 0) {
      return checkError("No jobs could be priced — JobTread may be unreachable.");
    }

    const over = priced.filter((p) => p.unbilled >= config.gapThreshold);
    over.sort((a, b) => b.unbilled - a.unbilled);

    const items: DigestItem[] = over.map((p) => ({
      title: `${p.job.customer ? `${p.job.customer} — ` : ""}${p.job.name} · ${money(p.unbilled)} unbilled`,
      detail:
        `${money(p.billedCost)} of approved vendor bills against ${money(p.invoicedCost)} of approved client invoices. ` +
        (p.draftInvoiceCost > 0 ? `${money(p.draftInvoiceCost)} is already on a draft invoice. ` : "") +
        (p.draftBillCost > 0 ? `${money(p.draftBillCost)} of bills are still in the coding queue.` : ""),
      sourceLink: `/unbilled?jobId=${encodeURIComponent(p.job.id)}`,
      sourceLabel: "Open unbilled view",
      amount: p.unbilled,
      group: p.job.customer || "Jobs",
    }));

    if (items.length === 0) {
      return allClear(`No job is more than ${money(config.gapThreshold)} ahead of its client invoicing (${priced.length} jobs checked).`);
    }
    const total = over.reduce((s, p) => s + p.unbilled, 0);
    return {
      status: "warning",
      items,
      summary: `${items.length} job${items.length === 1 ? "" : "s"} carrying ${money(total)} of cost that hasn't been invoiced to the client.`,
    };
  },
});
