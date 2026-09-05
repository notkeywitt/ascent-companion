import { Suspense } from "react";
import Link from "next/link";
import { billStatusLabel } from "@/components/BillStatusBadge";
import { Banner, Loading, PageHeader } from "@/components/ui";
import {
  getJobDocumentRollup,
  computeUnbilled,
  type DocRollupRow,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

/**
 * Server component. `jobId` comes from the URL (set by the Tracking Sheets job picker), so
 * the rollup is computed on the server and arrives in the initial HTML — no
 * client fetch waterfall. The Pave call is wrapped in <Suspense> below, so the
 * page shell (title/description) streams immediately and the totals stream in
 * when ready; a slow query never blocks first paint (no TTFB regression).
 * Changing the job re-navigates and re-renders server-side.
 */
export default async function UnbilledPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const { jobId: raw } = await searchParams;
  const jobId = (raw ?? "").trim();

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Unbilled"
        description={
          jobId
            ? "Approved bill cost not yet on an approved customer invoice."
            : "Pick a job above to see unbilled expenses."
        }
        actions={
          jobId ? (
            <Link
              href={`/trackingsheet?jobId=${encodeURIComponent(jobId)}`}
              className="text-xs font-semibold text-accent dark:text-accent-soft"
            >
              ← Tracking Sheets
            </Link>
          ) : undefined
        }
      />

      {jobId && (
        <Suspense key={jobId} fallback={<Loading label="Computing unbilled totals…" />}>
          <UnbilledData jobId={jobId} />
        </Suspense>
      )}
    </main>
  );
}

async function UnbilledData({ jobId }: { jobId: string }) {
  if (!hasGrant()) {
    return <Banner tone="error">JT_GRANT_KEY is not set. Add it to .env.local and restart.</Banner>;
  }

  let rollup: DocRollupRow[];
  let summary: ReturnType<typeof computeUnbilled>;
  try {
    rollup = await getJobDocumentRollup(getPaveConfig(), jobId);
    summary = computeUnbilled(rollup);
  } catch (e) {
    return <Banner tone="error">{e instanceof Error ? e.message : "Unknown error"}</Banner>;
  }

  return (
    <>
      <div className="mb-5 overflow-hidden rounded-2xl border border-accent/30 bg-accent/5">
        {/* Brand marquee rule (ochre in light, olive in dark) framing the headline number. */}
        <div className="h-1 bg-brand" />
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-accent dark:text-accent-soft">
            Unbilled (at cost)
          </div>
          <div className="mt-1 font-mono text-3xl font-bold">{money(summary.unbilled)}</div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
            <span>Approved bill cost</span>
            <span className="text-right font-mono">{money(summary.billedCost)}</span>
            <span>Invoiced (approved)</span>
            <span className="text-right font-mono">{money(summary.invoicedCost)}</span>
            <span>Draft invoice (staged)</span>
            <span className="text-right font-mono">{money(summary.draftInvoiceCost)}</span>
            <span>Draft bills (to code)</span>
            <span className="text-right font-mono">{money(summary.draftBillCost)}</span>
          </div>
        </div>
      </div>

      {rollup.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-ink-raised">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2 font-medium">Document</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">#</th>
              </tr>
            </thead>
            <tbody>
              {rollup.map((r, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.type}</span>{" "}
                    <span className="text-neutral-500">
                      / {r.type === "vendorBill" ? billStatusLabel(r.status) : r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{money(r.cost)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.priceWithTax ? money(r.priceWithTax) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-neutral-500">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
