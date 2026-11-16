"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/components/BillingSummary";
import { MonthPicker } from "@/components/MonthPicker";
import { billingMonths } from "@/lib/billingMonths";
import type { PayablesSummary } from "@/lib/accountsPayable";
import type { PaidState } from "@/lib/billPaid";
import {
  Banner,
  Chip,
  ChipScroller,
  EmptyState,
  FilterChip,
  ListCard,
  ListRow,
  Loading,
  StatementBlock,
} from "@/components/ui";

/**
 * ACCOUNTS PAYABLE — the Bills dashboard's tab. Every bill in a billing month,
 * Sunset and Expenses left out, each marked paid or not. Read-only. The rules
 * live in `src/lib/accountsPayable.ts`.
 */

type Filter = "all" | "unpaid" | "paid";

const PAID_CHIP: Record<PaidState, { tone: "danger" | "warning" | "success"; label: string }> = {
  unpaid: { tone: "danger", label: "Unpaid" },
  partial: { tone: "warning", label: "Part paid" },
  paid: { tone: "success", label: "Paid" },
};

export function AccountsPayable() {
  const months = useMemo(() => billingMonths(), []);
  const [ym, setYm] = useState("");
  const [data, setData] = useState<PayablesSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  // Open on the billing month in force (Home's masthead month).
  useEffect(() => {
    let live = true;
    fetch("/api/billing-month")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setYm(d?.ym || months[0].value))
      .catch(() => live && setYm(months[0].value));
    return () => {
      live = false;
    };
  }, [months]);

  useEffect(() => {
    if (!ym) return;
    let live = true;
    setLoading(true);
    setError("");
    fetch(`/api/accounts-payable?ym=${encodeURIComponent(ym)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `Could not read the month's bills (${r.status}).`);
        return d as PayablesSummary;
      })
      .then((d) => live && setData(d))
      .catch((e) => {
        if (!live) return;
        setData(null);
        setError(e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [ym]);

  const shown = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.bills;
    return data.bills.filter((b) => (b.paid === "paid") === (filter === "paid"));
  }, [data, filter]);

  const leftOut = data
    ? [
        data.sunsetLeftOut ? `${data.sunsetLeftOut} Sunset` : "",
        data.expensesLeftOut ? `${data.expensesLeftOut} Expense${data.expensesLeftOut === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(" and ")
    : "";

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <MonthPicker value={ym} options={months} onChange={setYm} disabled={loading} />
      </div>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading ? (
        <Loading label="Reading the month's bills…" />
      ) : !data ? null : (
        <>
          <StatementBlock
            label="Still owed"
            value={money(data.owed)}
            sub={`${data.unpaidCount} unpaid · ${data.paidCount} paid · ${money(data.total)} billed this month`}
            footnote={`Paid or not comes from QuickBooks, through JobTread. Sunset and Expenses are left out${
              leftOut ? ` (${leftOut} this month)` : ""
            }.`}
          />

          <ChipScroller className="mt-5">
            {(["all", "unpaid", "paid"] as const).map((f) => (
              <FilterChip key={f} on={filter === f} onClick={() => setFilter(f)}>
                {f === "all"
                  ? `All ${data.bills.length}`
                  : f === "unpaid"
                    ? `Unpaid ${data.unpaidCount}`
                    : `Paid ${data.paidCount}`}
              </FilterChip>
            ))}
          </ChipScroller>

          {shown.length === 0 ? (
            <EmptyState>
              {data.bills.length === 0 ? "No bills in this month." : "No bills match this filter."}
            </EmptyState>
          ) : (
            <ListCard className="mt-3">
              {shown.map((b) => {
                const chip = PAID_CHIP[b.paid];
                const job = [b.customerName, b.jobName].filter(Boolean).join(" - ");
                return (
                  <ListRow
                    key={b.id}
                    href={`/bill/${encodeURIComponent(b.id)}?jobId=${encodeURIComponent(b.jobId)}`}
                    label={b.vendor}
                    desc={[job, b.status === "draft" ? "draft" : ""].filter(Boolean).join(" · ")}
                    trailing={
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums">{money(b.cost)}</span>
                        <Chip tone={chip.tone}>{chip.label}</Chip>
                        {b.paid === "partial" && (
                          <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                            {money(b.owed)} owed
                          </span>
                        )}
                      </span>
                    }
                  />
                );
              })}
            </ListCard>
          )}
        </>
      )}
    </div>
  );
}
