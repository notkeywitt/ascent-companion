"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/components/BillingSummary";
import { BillView } from "@/app/bill/[docId]/BillView";
import { Dialog } from "@/components/Dialog";
import { MonthPicker } from "@/components/MonthPicker";
import { billingMonths } from "@/lib/billingMonths";
import type { Payable, PayablesSummary } from "@/lib/accountsPayable";
import type { PaidState } from "@/lib/billPaid";
import {
  Banner,
  Button,
  Checkbox,
  Chip,
  ChipScroller,
  EmptyState,
  FilterChip,
  ListCard,
  ListRow,
  Loading,
  SectionHeading,
  Segmented,
  StatementBlock,
} from "@/components/ui";

/**
 * ACCOUNTS PAYABLE — the Bills dashboard's tab. Every bill in a billing month,
 * Sunset and Expenses left out, each marked paid or not. Paid or not is read-only; the check-mailed box saves to the companion database. The rules
 * live in `src/lib/accountsPayable.ts`.
 */

type Filter = "all" | "unpaid" | "paid";
type GroupBy = "none" | "vendor" | "job";

const PAID_CHIP: Record<PaidState, { tone: "danger" | "warning" | "success"; label: string }> = {
  unpaid: { tone: "danger", label: "Unpaid" },
  partial: { tone: "warning", label: "Part paid" },
  paid: { tone: "success", label: "Paid" },
};

/** ISO timestamp → "Nov 19, 2026". */
const mailedLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export function AccountsPayable() {
  const months = useMemo(() => billingMonths(), []);
  const [ym, setYm] = useState("");
  const [data, setData] = useState<PayablesSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  // The bill open in the pop-up. The list stays put behind it.
  const [openId, setOpenId] = useState("");
  const [reload, setReload] = useState(0);
  // Bills whose check the office marked mailed: docId -> ISO time.
  const [mailed, setMailed] = useState<Record<string, string>>({});
  // A bill whose Mailed mark is about to come off: it waits for a confirmation.
  const [unmailId, setUnmailId] = useState("");

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
    // A re-read after the pop-up closes keeps the list on screen.
    if (reload === 0) setLoading(true);
    setError("");
    fetch(`/api/accounts-payable?ym=${encodeURIComponent(ym)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `Could not read the month's bills (${r.status}).`);
        return d as PayablesSummary;
      })
      .then(async (d) => {
        if (!live) return;
        setData(d);
        // The mailed marks live in the companion database. A failed read leaves the boxes empty.
        const ids = d.bills.map((b) => b.id).join(",");
        const m = ids
          ? await fetch(`/api/check-mailed?ids=${encodeURIComponent(ids)}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          : null;
        if (live) setMailed(m?.mailed ?? {});
      })
      .catch((e) => {
        if (!live) return;
        setData(null);
        setError(e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [ym, reload]);

  async function toggleMailed(id: string, on: boolean) {
    const before = mailed;
    setMailed((m) => {
      const n = { ...m };
      if (on) n[id] = new Date().toISOString();
      else delete n[id];
      return n;
    });
    try {
      const r = await fetch("/api/check-mailed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: id, mailed: on }),
      });
      if (!r.ok) throw new Error();
      // Keep the date the server recorded.
      const j = await r.json().catch(() => null);
      if (on && j?.mailedAt) setMailed((m) => ({ ...m, [id]: j.mailedAt }));
    } catch {
      setMailed(before);
      setError("Could not save the check mailed mark. Try again.");
    }
  }

  const shown = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.bills;
    return data.bills.filter((b) => (b.paid === "paid") === (filter === "paid"));
  }, [data, filter]);

  // Groups keep the list's order inside (unpaid first); the groups run A to Z.
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", title: "", bills: shown }];
    const m = new Map<string, Payable[]>();
    for (const b of shown) {
      const k =
        groupBy === "vendor"
          ? b.vendor || "Unknown vendor"
          : [b.customerName, b.jobName].filter(Boolean).join(" - ") || "No job";
      m.set(k, [...(m.get(k) ?? []), b]);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, bills]) => ({ key: title, title, bills }));
  }, [shown, groupBy]);

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

          <div className="mt-2">
            <Segmented<GroupBy>
              label="Group bills"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "none", label: "All" },
                { value: "vendor", label: "Vendor" },
                { value: "job", label: "Job" },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <EmptyState>
              {data.bills.length === 0 ? "No bills in this month." : "No bills match this filter."}
            </EmptyState>
          ) : (
            <div className="mt-3 space-y-4">
              {groups.map((g) => (
                <div key={g.key} className="space-y-2">
                  {g.title && (
                    <SectionHeading>
                      {`${g.title} · ${g.bills.length} · ${money(g.bills.reduce((t, x) => t + x.cost, 0))} total · ${money(g.bills.reduce((t, x) => t + x.owed, 0))} owed`}
                    </SectionHeading>
                  )}
                  <ListCard>
                    {g.bills.map((b) => {
                      const chip = PAID_CHIP[b.paid];
                      const job = [b.customerName, b.jobName].filter(Boolean).join(" - ");
                      return (
                        <div key={b.id} className="flex items-center border-b border-line-soft last:border-b-0">
                          <Checkbox
                            aria-label={`Check mailed for ${b.vendor}`}
                            title="Check mailed"
                            className="shrink-0 py-4 pl-3"
                            checked={b.id in mailed}
                            onChange={(e) => {
                              // Once mailed, taking the mark off asks first.
                              if (!e.target.checked && b.id in mailed) setUnmailId(b.id);
                              else toggleMailed(b.id, e.target.checked);
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <ListRow
                              className="!border-b-0"
                              onClick={() => setOpenId(b.id)}
                              label={b.vendor}
                              desc={[groupBy === "job" ? "" : job, b.status === "draft" ? "draft" : ""]
                                .filter(Boolean)
                                .join(" · ")}
                              trailing={
                                <span className="flex shrink-0 flex-col items-end gap-1">
                                  <span className="text-sm font-semibold tabular-nums">{money(b.cost)}</span>
                                  <Chip tone={chip.tone}>{chip.label}</Chip>
                                  {b.id in mailed && (
                                    <>
                                      <Chip tone="success">Mailed</Chip>
                                      {mailed[b.id] && (
                                        <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                                          {mailedLabel(mailed[b.id])}
                                        </span>
                                      )}
                                    </>
                                  )}
                                  {b.paid === "partial" && (
                                    <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                                      {money(b.owed)} owed
                                    </span>
                                  )}
                                </span>
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </ListCard>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {unmailId && (
        <Dialog
          onClose={() => setUnmailId("")}
          title="Remove the mailed mark?"
          description={`${data?.bills.find((x) => x.id === unmailId)?.vendor ?? "This bill"}'s check is marked mailed${
            mailed[unmailId] ? ` on ${mailedLabel(mailed[unmailId])}` : ""
          }. The date is lost.`}
          footer={
            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="secondary" className="min-h-11 w-full" onClick={() => setUnmailId("")}>
                Keep it
              </Button>
              <Button
                className="min-h-11 w-full"
                onClick={() => {
                  const id = unmailId;
                  setUnmailId("");
                  toggleMailed(id, false);
                }}
              >
                Remove mark
              </Button>
            </div>
          }
        >
          {null}
        </Dialog>
      )}

      {openId && (
        <Dialog
          size="xl"
          pad={false}
          label="Bill"
          onClose={() => {
            setOpenId("");
            setReload((n) => n + 1);
          }}
        >
          <BillView key={openId} docId={openId} embedded inset />
        </Dialog>
      )}
    </div>
  );
}
