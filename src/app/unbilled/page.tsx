import { Suspense } from "react";
import Link from "next/link";
import { billStatusLabel } from "@/components/BillStatusBadge";
import { JobParamPicker } from "@/components/JobPicker";
import {
  Banner,
  EmptyState,
  ListCard,
  ListRow,
  Loading,
  PageHeader,
  StatementBlock,
} from "@/components/ui";
import { getUninvoicedBills, type UninvoicedBills } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Server component. `jobId` comes from the URL — set by this page's own picker
 * (a client child; the header carries none) or by whoever linked here with a job
 * already chosen (Coding Review, the daily digest's cost-vs-invoice check). So
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
            ? "Bills and time not yet on a client invoice, over the life of the job."
            : "Pick a job to see its unbilled expenses."
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

      <div className="mb-4">
        <JobParamPicker includeAll={false} placeholder="Choose a job…" />
      </div>

      {jobId && (
        <Suspense key={jobId} fallback={<Loading label="Computing unbilled totals…" />}>
          <UnbilledData jobId={jobId} />
        </Suspense>
      )}
    </main>
  );
}

/**
 * Unbilled = every finalized vendor bill and time entry that is on no client
 * invoice, over the whole job — `getUninvoicedBills` with no month. It checks
 * each bill and time entry for an invoice link, the same rule as the home
 * cards' "To invoice" figure. A draft invoice does not count as invoiced.
 *
 * It used to subtract Σ invoice cost from Σ approved bill cost. That cannot
 * see which bill went on which invoice, and it left labor out of the bill side
 * while every invoice carries it, so a job the crew worked read negative.
 */
async function UnbilledData({ jobId }: { jobId: string }) {
  if (!hasGrant()) {
    return <Banner tone="error">JT_GRANT_KEY is not set. Add it to .env.local and restart.</Banner>;
  }

  let data: UninvoicedBills;
  try {
    data = await getUninvoicedBills(getPaveConfig(), jobId);
  } catch (e) {
    return <Banner tone="error">{e instanceof Error ? e.message : "Unknown error"}</Banner>;
  }

  const time = data.lines.find((l) => l.key === "time");
  const timeCost = time?.cost ?? 0;
  const hours = (time?.timeEntries ?? []).reduce((h, t) => h + t.hours, 0);
  // One row per bill. The Sunset group already lists its bills; name them by vendor.
  const bills = data.lines.flatMap((l) =>
    (l.bills ?? []).map((b) => ({ ...b, vendor: l.isSunset ? "Sunset Builders Supply" : l.label })),
  );

  return (
    <>
      <StatementBlock
        className="mb-5"
        label="Unbilled (at cost)"
        value={money(data.total)}
        sub={`${money(data.total - timeCost)} bills · ${money(timeCost)} labor · all months`}
        footnote="A draft invoice does not count as invoiced."
      />

      {data.lines.length === 0 ? (
        <EmptyState>Every bill and time entry on this job is on a client invoice.</EmptyState>
      ) : (
        <ListCard>
          {bills.map((b) => (
            <ListRow
              key={b.id}
              href={`/bill/${encodeURIComponent(b.id)}?jobId=${encodeURIComponent(jobId)}`}
              label={b.vendor}
              desc={[b.label, b.status && billStatusLabel(b.status)].filter(Boolean).join(" · ")}
              trailing={<span className="text-sm font-semibold tabular-nums">{money(b.cost)}</span>}
            />
          ))}
          {time && (
            <ListRow
              label="Time & labor"
              desc={`${time.timeEntries?.length ?? 0} entries · ${Math.round(hours * 10) / 10} h`}
              trailing={
                <span className="text-sm font-semibold tabular-nums">{money(timeCost)}</span>
              }
            />
          )}
        </ListCard>
      )}
    </>
  );
}
