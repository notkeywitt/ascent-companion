"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BillView } from "@/app/bill/[docId]/BillView";
import {
  EmptyState,
  Input,
  ListCard,
  ListRow,
  Loading,
  SectionHeading,
  Segmented,
  SplitView,
  Toggle,
} from "@/components/ui";
import { groupBills, type BillGroupBy, type BillSort } from "./billGroups";
import { money } from "@/lib/money";
import { clearTouchedBills, touchedBillCount } from "@/lib/billTouch";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";

/**
 * Bills — the draft bills waiting to be coded, newest first, with the open
 * bill's summary in a panel beside the list (SplitView).
 *
 * The list is the same one Today's "Bills to code" row opens (/api/coding-queue).
 * The panel IS the bill page (BillView, embedded): the same coding, Save,
 * actions drawer and ‹ prev / next ›. The selected bill rides in the URL
 * (?docId=…) so Back and a shared link keep it.
 *
 * Gated by the "bills" view in src/lib/views.ts. /api/coding-queue rides the
 * "recode" gate, so a person needs both — office and admin hold both by default.
 */

interface Draft {
  id: string;
  jobId?: string;
  jobName?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  cost?: number;
  issueDate?: string;
  /** Marked reviewed in the coding card (companion-local, /api/coding-queue). */
  reviewed?: boolean;
}

/** "2026-10-19" → "Oct 19, 2026". */
const dateLabel = (d?: string) => {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export function BillsBrowser() {
  const router = useRouter();
  const search = useSearchParams();
  const openId = search.get("docId") ?? "";

  const [bills, setBills] = useState<Draft[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BillSort>("date");
  const [groupBy, setGroupBy] = useState<BillGroupBy>("none");
  const [showReviewed, setShowReviewed] = useState(true);

  // Re-read the list when a bill was written in the panel (saved, approved,
  // voided) — an approved bill is no longer a draft and leaves the list.
  const loadList = () =>
    fetch("/api/coding-queue", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) =>
        j.error ? setError(String(j.error)) : setBills(Array.isArray(j.bills) ? j.bills : []),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"));
  useEffect(() => {
    loadList();
  }, []);
  useEffect(() => {
    if (touchedBillCount() === 0) return;
    clearTouchedBills();
    loadList();
  }, [openId]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (bills ?? []).filter(
        (b) =>
          (showReviewed || !b.reviewed) &&
          (!q ||
            [b.fromName, b.jobName, b.externalId, b.number].some((s) =>
              (s ?? "").toLowerCase().includes(q),
            )),
      ),
    [bills, q, showReviewed],
  );
  const groups = useMemo(() => groupBills(shown, sort, groupBy), [shown, sort, groupBy]);

  // The selection lives in the URL, so Back closes the panel on a phone.
  const select = (id: string) =>
    confirmLeaveIfDirty() && router.push(id ? `/bills?docId=${encodeURIComponent(id)}` : "/bills");

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 lg:max-w-[96rem] pb-24 pt-6">

      <SplitView
        onClose={() => select("")}
        backLabel="Back to bills"
        empty="Pick a bill to see it here."
        cols="lg:grid-cols-[18rem_minmax(0,1fr)]"
        detail={openId ? <BillView key={openId} docId={openId} embedded /> : null}
        list={
          // No page header: the open bill's title is the page's title.
          <div className="space-y-2">
            {!openId && <h1 className="sr-only">Bills</h1>}
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Vendor, job or invoice #"
              aria-label="Search bills"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented<BillSort>
                label="Sort bills"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "date", label: "Date" },
                  { value: "name", label: "Name" },
                ]}
              />
              <Segmented<BillGroupBy>
                label="Group bills"
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { value: "none", label: "All" },
                  { value: "job", label: "Job" },
                  { value: "vendor", label: "Vendor" },
                ]}
              />
              <Toggle checked={showReviewed} onChange={setShowReviewed} label="Show reviewed" />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            {!bills && !error && <Loading label="Loading bills…" />}
            {bills && (
              <div className="space-y-4 pt-2">
                {shown.length === 0 ? (
                  <EmptyState>
                    {q
                      ? `Nothing matches “${query.trim()}”.`
                      : bills.length > 0
                        ? "Every bill here is reviewed. Turn on Show reviewed to see them."
                        : "No bills waiting to be coded."}
                  </EmptyState>
                ) : (
                  // Sunset bills are always one group, at the foot (billGroups.ts).
                  groups.map((g) => (
                    <div key={g.key} className="space-y-2">
                      <SectionHeading>{`${g.title} · ${g.bills.length}`}</SectionHeading>
                      <ListCard>
                        {g.bills.map((b) => (
                          <ListRow
                            key={b.id}
                            onClick={() => select(b.id)}
                            selected={b.id === openId}
                            label={b.fromName || "Unknown vendor"}
                            desc={[
                              groupBy === "job" && g.title !== "Sunset"
                                ? ""
                                : b.jobName || "No job",
                              dateLabel(b.issueDate),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            trailing={
                              <span className="text-right">
                                {typeof b.cost === "number" && (
                                  <span className="block text-sm font-semibold tabular-nums">
                                    {money(b.cost)}
                                  </span>
                                )}
                                {b.reviewed && (
                                  <span className="block text-[11px] font-semibold text-ok">
                                    ✓ Reviewed
                                  </span>
                                )}
                              </span>
                            }
                          />
                        ))}
                      </ListCard>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        }
      />
    </main>
  );
}
