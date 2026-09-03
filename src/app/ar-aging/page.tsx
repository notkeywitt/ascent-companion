"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/components/BillingSummary";
import {
  AR_BUCKETS,
  type ArAgingSummary,
  type ArBucketId,
} from "@/lib/arAging";
import {
  Banner,
  Card,
  Chip,
  ChipScroller,
  EmptyState,
  FilterChip,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  StatementBlock,
} from "@/components/ui";

/**
 * ACCOUNTS RECEIVABLE — who owes Ascent money, and for how long.
 *
 * Every figure on this page is JobTread's own: `balance` and `amountPaid` are
 * derived by JobTread from QuickBooks, and nothing here recomputes them. The
 * page's whole job is to SHOW numbers the app already had and never displayed.
 *
 * The page's ONE display figure is what is overdue, not what is outstanding.
 * Outstanding includes an invoice sent this morning, which is not a problem;
 * overdue is the number that changes what someone does today.
 */

const shortDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

/** How late, in words. A number of days is precise; "3 months" is legible. */
const lateness = (days: number) => {
  if (days <= 0) return days === 0 ? "due today" : `due in ${-days} day${days === -1 ? "" : "s"}`;
  if (days < 45) return `${days} day${days === 1 ? "" : "s"} late`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} late`;
};

/** Over 60 days is the point a receivable stops being a timing question. */
const toneFor = (days: number) => (days > 60 ? "danger" : days > 0 ? "warning" : "neutral");

export default function ArAgingPage() {
  const [data, setData] = useState<ArAgingSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState<ArBucketId | "all">("all");
  const [byCustomer, setByCustomer] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/ar-aging")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `Could not read receivables (${r.status}).`);
        return d as ArAgingSummary;
      })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(
    () => (data ? data.invoices.filter((i) => bucket === "all" || i.bucket === bucket) : []),
    [data, bucket],
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader
        title="Receivables"
        description="Unpaid client invoices, oldest first. Balances come from JobTread, which derives them from QuickBooks — nothing here is recomputed."
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading ? (
        <Loading label="Reading open invoices…" />
      ) : !data ? null : data.invoiceCount === 0 ? (
        <EmptyState>Nothing is outstanding. Every live client invoice is paid in full.</EmptyState>
      ) : (
        <>
          <StatementBlock
            label="Overdue"
            value={money(data.totalOverdue)}
            sub={`${money(data.totalOutstanding)} outstanding in total · as at ${shortDate(data.asOf)}`}
            footnote="An invoice ages from its due date where it has one, and from its issue date where it does not — each row says which."
          />

          {/* The buckets, as the thing you scan first. */}
          <div className="mt-5">
            <SectionHeading>By age</SectionHeading>
            <Card pad={false} className="mt-2 divide-y divide-line-soft">
              {data.buckets
                .filter((b) => b.count > 0)
                .map((b) => (
                  <div key={b.id} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                    <p className="min-w-0 text-sm">
                      {b.label}
                      <span className="ml-2 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                        {b.count} invoice{b.count === 1 ? "" : "s"}
                      </span>
                    </p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{money(b.amount)}</p>
                  </div>
                ))}
            </Card>
          </div>

          <ChipScroller className="mt-5">
            <FilterChip on={!byCustomer} onClick={() => setByCustomer(false)}>
              Invoices
            </FilterChip>
            <FilterChip on={byCustomer} onClick={() => setByCustomer(true)}>
              Customers
            </FilterChip>
          </ChipScroller>

          {byCustomer ? (
            <>
              <SectionHeading
                className="mt-4"
                trailing={`${data.customers.length} customer${data.customers.length === 1 ? "" : "s"}`}
              >
                Who owes what
              </SectionHeading>
              <Card pad={false} className="mt-2 divide-y divide-line-soft">
                {data.customers.map((c) => (
                  <div key={c.customerName} className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 text-sm font-semibold">{c.customerName}</p>
                      <p className="shrink-0 text-sm tabular-nums">{money(c.amount)}</p>
                    </div>
                    <MetaLine
                      className="mt-1"
                      items={[
                        `${c.count} invoice${c.count === 1 ? "" : "s"}`,
                        lateness(c.worstDaysOverdue),
                        // Only name the buckets a customer is actually in.
                        AR_BUCKETS.filter((b) => b.id !== "current" && c.byBucket[b.id] > 0)
                          .map((b) => `${b.short}: ${money(c.byBucket[b.id])}`)
                          .join(", "),
                      ]}
                    />
                  </div>
                ))}
              </Card>
            </>
          ) : (
            <>
              <ChipScroller className="mt-4">
                <FilterChip on={bucket === "all"} onClick={() => setBucket("all")}>
                  All
                </FilterChip>
                {data.buckets
                  .filter((b) => b.count > 0)
                  .map((b) => (
                    <FilterChip key={b.id} on={bucket === b.id} onClick={() => setBucket(b.id)}>
                      {b.short} ({b.count})
                    </FilterChip>
                  ))}
              </ChipScroller>

              <SectionHeading className="mt-4" trailing={`${shown.length}`}>
                Oldest first
              </SectionHeading>
              <Card pad={false} className="mt-2 divide-y divide-line-soft">
                {shown.map((i) => (
                  <a
                    key={i.id}
                    href={i.jtUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold">
                        {i.customerName || "(no customer)"}
                        {i.number && (
                          <span className="ml-2 font-normal text-neutral-500 dark:text-neutral-400">
                            #{i.number}
                          </span>
                        )}
                      </p>
                      <p className="shrink-0 text-sm font-semibold tabular-nums">
                        {money(i.balance)}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {i.daysOverdue > 0 && (
                        <Chip tone={toneFor(i.daysOverdue)}>{lateness(i.daysOverdue)}</Chip>
                      )}
                      <MetaLine
                        items={[
                          i.jobName,
                          // Which date it aged from, stated — otherwise the page
                          // cannot be reconciled against QuickBooks.
                          i.basis === "due"
                            ? `due ${shortDate(i.basisDate)}`
                            : `issued ${shortDate(i.basisDate)}, no due date`,
                          // Part payment is the case worth naming: the balance
                          // alone hides that money already came in.
                          i.amountPaid > 0 ? `${money(i.amountPaid)} of ${money(i.total)} paid` : "",
                        ]}
                      />
                    </div>
                  </a>
                ))}
              </Card>
            </>
          )}

          {data.unageable.length > 0 && (
            <>
              <SectionHeading className="mt-6">Cannot be aged</SectionHeading>
              <Card className="mt-2">
                <p className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {data.unageable.length} invoice{data.unageable.length === 1 ? "" : "s"} worth{" "}
                  {money(data.unageable.reduce((s, i) => s + i.balance, 0))} carry neither a due
                  date nor a readable issue date. They count toward what is outstanding and never
                  toward what is overdue — dating them in JobTread is what moves them into a
                  bucket.
                </p>
              </Card>
            </>
          )}
        </>
      )}
    </main>
  );
}
