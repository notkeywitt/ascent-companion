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
  PageHeader,
  SectionHeading,
  SplitView,
} from "@/components/ui";
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
          !q ||
          [b.fromName, b.jobName, b.externalId, b.number].some((s) =>
            (s ?? "").toLowerCase().includes(q),
          ),
      ),
    [bills, q],
  );

  // The selection lives in the URL, so Back closes the panel on a phone.
  const select = (id: string) =>
    confirmLeaveIfDirty() &&
    router.push(id ? `/bills?docId=${encodeURIComponent(id)}` : "/bills");

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 lg:max-w-[96rem] pb-24 pt-6">
      <PageHeader title="Bills" description="Draft bills waiting to be coded, newest first." />

      <SplitView
        onClose={() => select("")}
        backLabel="Back to bills"
        empty="Pick a bill to see it here."
        cols="lg:grid-cols-[18rem_minmax(0,1fr)]"
        detail={openId ? <BillView key={openId} docId={openId} embedded /> : null}
        list={
          <div className="space-y-2">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Vendor, job or invoice #"
              aria-label="Search bills"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            {!bills && !error && <Loading label="Loading bills…" />}
            {bills && (
              <div className="space-y-2 pt-2">
                <SectionHeading>{`To code · ${shown.length}`}</SectionHeading>
                {shown.length === 0 ? (
                  <EmptyState>
                    {q ? `Nothing matches “${query.trim()}”.` : "No bills waiting to be coded."}
                  </EmptyState>
                ) : (
                  <ListCard>
                    {shown.map((b) => (
                      <ListRow
                        key={b.id}
                        onClick={() => select(b.id)}
                        selected={b.id === openId}
                        label={b.fromName || "Unknown vendor"}
                        desc={[b.jobName || "No job", dateLabel(b.issueDate)]
                          .filter(Boolean)
                          .join(" · ")}
                        trailing={
                          typeof b.cost === "number" ? (
                            <span className="text-sm font-semibold tabular-nums">
                              {money(b.cost)}
                            </span>
                          ) : undefined
                        }
                      />
                    ))}
                  </ListCard>
                )}
              </div>
            )}
          </div>
        }
      />
    </main>
  );
}
