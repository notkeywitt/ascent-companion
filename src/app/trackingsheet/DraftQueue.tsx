"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import { driveMainWindowToDoc, money } from "@/components/BillingSummary";
import { Banner, CardSkeletonList, EmptyState, Toggle } from "@/components/ui";
import { useCopy } from "@/components/CopyProvider";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  DraftBudgetRail,
  DraftCodingPanel,
  useBillEditor,
  useIsWide,
  type Selection,
} from "./DraftWorkbench";

/**
 * "Needs coding" — every draft vendor bill in JobTread, across every job and
 * every month.
 *
 * This is what the Coding Review page (/coding) was, and it is the one thing the
 * month roster next door cannot do: a draft that was filed to the wrong billing
 * period, or simply left behind three months ago, never appears in a
 * month-scoped list. Here it does, because this queue is scoped by STATUS
 * (draft) rather than by date — which is exactly how a forgotten bill gets
 * found.
 *
 * LAYOUT. On a phone this is a list, and a row opens the bill's own page. From
 * `xl` up it becomes the same three-column workbench the job view uses —
 * Budget | bills | Coding — and a row SELECTS its bill instead of navigating to
 * it, so the whole queue can be worked without leaving the page. The side
 * columns and the editing state live in DraftWorkbench.tsx; read that file for
 * why they load per-bill rather than per-job.
 */

interface Bill {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  status?: string;
  cost?: number; // pre-tax line subtotal
  nonRecoverableTax?: number; // recorded sales tax (document-level, "Tax")
  issueDate?: string;
  jobId?: string; // set only when listing across all jobs
  jobName?: string;
  saved?: boolean; // Save has been clicked on this bill in the Assistant
  reviewed?: boolean; // bill explicitly marked reviewed in the Assistant
}

/**
 * A bill's amount owed is JobTread's document `cost` = the sum of the line costs,
 * which IS JobTread's bill total. The fixed sales tax (`nonRecoverableTax`) is
 * carved OUT of that total for the subtotal, never added on top (confirmed live
 * 2026-07-30). Matches the bill page's total exactly.
 */
const billAmount = (b: Bill) => b.cost ?? 0;

const invoiceId = (b: Bill) => b.externalId || b.number || "";
// Sunset keeps "Vendor · Invoice ID" (their invoice # is how the office tells
// same-vendor bills apart); every other vendor shows just its name.
const billTitle = (b: Bill) => {
  const vendor = b.fromName || b.subject || "Vendor bill";
  const inv = invoiceId(b);
  const isSunset = /sunset/i.test(vendor);
  return isSunset && inv ? `${vendor} · ${inv}` : vendor;
};

/**
 * A queue row's outer element: a <button> that selects the bill on the
 * three-column layout, a <Link> to the bill's own page everywhere else.
 */
function RowShell({
  wide,
  active,
  href,
  onNavigate,
  onSelect,
  children,
}: {
  wide: boolean;
  active: boolean;
  href: string;
  onNavigate: () => void;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const cls = `block w-full rounded-xl border bg-white p-3 text-left transition hover:border-accent hover:shadow-sm dark:bg-ink-raised ${
    active ? "border-accent ring-1 ring-accent" : "border-line"
  }`;
  return wide ? (
    <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined} className={cls}>
      {children}
    </button>
  ) : (
    <Link href={href} onClick={onNavigate} className={cls}>
      {children}
    </Link>
  );
}

export function DraftQueue() {
  const c = useCopy();
  const wide = useIsWide();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Default to showing everything, including already-reviewed bills.
  const [hideReviewed, setHideReviewed] = useState(false);
  // The current month is usually still filling in, so hide it by default —
  // a toggle brings it back into view.
  const [hideCurrentMonth, setHideCurrentMonth] = useState(true);
  /** The bill the side columns are pointed at (xl and up). */
  const [selId, setSelId] = useState("");
  /**
   * Saved / reviewed marks earned in THIS session, laid over the list.
   * /api/coding-queue is fetched once; without this, coding a bill in the panel
   * would leave its row in the list still saying it had never been touched.
   */
  const [flags, setFlags] = useState<Record<string, { saved?: boolean; reviewed?: boolean }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      setBills(null);
      try {
        const res = await fetch("/api/coding-queue");
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) setError(json.error ?? "Request failed");
        else setBills(json.bills ?? []);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // issueDate is yyyy-MM-dd; compare against the device-local current month.
  const now = new Date();
  const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const isCurrentMonth = (b: Bill) => (b.issueDate ?? "").startsWith(currentMonthPrefix);

  const flagged = useCallback(
    (b: Bill) => ({
      saved: flags[b.id]?.saved ?? b.saved ?? false,
      reviewed: flags[b.id]?.reviewed ?? b.reviewed ?? false,
    }),
    [flags],
  );

  const reviewedCount = bills?.filter((b) => flagged(b).reviewed).length ?? 0;
  const currentMonthCount = bills?.filter(isCurrentMonth).length ?? 0;
  // What the list actually renders — reviewed bills and/or the current month
  // drop out unless shown.
  const visible = useMemo(
    () =>
      bills
        ? bills.filter(
            (b) =>
              (!hideReviewed || !flagged(b).reviewed) &&
              (!hideCurrentMonth || !isCurrentMonth(b)),
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills, hideReviewed, hideCurrentMonth, flagged, currentMonthPrefix],
  );
  const total = visible?.reduce((s, b) => s + billAmount(b), 0) ?? 0;

  // ---- the selected bill, and stepping through the queue -------------------

  const selIdx = visible?.findIndex((b) => b.id === selId) ?? -1;
  const selBill = selIdx >= 0 ? visible![selIdx] : null;
  const sel: Selection | null = selBill
    ? {
        docId: selBill.id,
        jobId: (selBill.jobId ?? "").trim(),
        label: billTitle(selBill),
        jobName: selBill.jobName ?? "",
      }
    : null;

  const onSaved = useCallback((docId: string) => {
    setFlags((f) => ({ ...f, [docId]: { ...f[docId], saved: true } }));
  }, []);
  const onReviewed = useCallback((docId: string, v: boolean) => {
    setFlags((f) => ({ ...f, [docId]: { ...f[docId], reviewed: v } }));
  }, []);
  const editor = useBillEditor(sel, { onSaved, onReviewed });

  // The panel's edits are staged in the browser until Save — but they are now
  // also autosaved and offered back on return, so the prompt is a reminder that
  // JobTread hasn't got them yet, not a warning that they're about to go.
  useUnsavedChanges(
    editor.changeCount > 0,
    "This bill has unsaved coding changes. They'll be saved and offered back when you return — leave now?",
  );

  /**
   * Move the panel to another bill. No longer a decision: the outgoing bill's
   * unsaved coding is saved under its own key and offered straight back when it
   * is reopened (src/lib/codingDraft.ts), so stepping down the list costs
   * nothing and the old "discard them?" prompt would now be a lie.
   */
  const select = useCallback(
    (id: string) => {
      if (id === selId) return;
      setSelId(id);
      const b = bills?.find((x) => x.id === id);
      if (b) driveMainWindowToDoc((b.jobId ?? "").trim(), b.id);
    },
    [selId, bills],
  );

  /**
   * The bill was re-filed onto another job, so JobTread deleted this document
   * and recreated it elsewhere — the row is stale. Drop it and step to whatever
   * takes its place, the same landing the reviewed-filter case gets below.
   */
  const dropBill = useCallback((docId: string) => {
    setBills((prev) => (prev ? prev.filter((b) => b.id !== docId) : prev));
  }, []);

  const step = (delta: number) => {
    if (!visible || selIdx < 0) return;
    const next = visible[selIdx + delta];
    if (next) select(next.id);
  };

  // Marking the open bill reviewed while "show reviewed" is off filters its row
  // out from under you — which would otherwise blank both side columns at the
  // exact moment you finished a bill. Move to whatever now occupies its place
  // instead, so finishing one bill lands you on the next.
  const lastIdx = useRef(0);
  useEffect(() => {
    if (selIdx >= 0) lastIdx.current = selIdx;
  }, [selIdx]);
  useEffect(() => {
    if (!selId || selIdx >= 0 || !visible) return;
    const next = visible[Math.min(lastIdx.current, visible.length - 1)];
    setSelId(next?.id ?? "");
  }, [selId, selIdx, visible]);

  // Land on the first bill so the workbench opens ready to work, rather than
  // with two empty columns. Desktop only — below xl the columns aren't rendered
  // and the fetch would be spent on nothing. Once only: clearing the selection
  // by filtering shouldn't yank you back to the top of the list.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!wide || didAutoSelect.current || !visible || visible.length === 0) return;
    didAutoSelect.current = true;
    setSelId(visible[0].id);
  }, [wide, visible]);

  // Keep the selected row on screen while stepping with ‹ Prev / Next ›.
  useEffect(() => {
    if (!wide || !selId) return;
    document
      .getElementById(`draft-row-${selId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selId, wide]);

  const list = (
    <>
      {loading && <CardSkeletonList rows={4} />}

      {error && <Banner tone="error">{error}</Banner>}

      {bills && visible && (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-sm font-medium">
                  {visible.length} draft {visible.length === 1 ? "bill" : "bills"}
                </span>
                {hideReviewed && reviewedCount > 0 && (
                  <span className="text-xs text-neutral-400">· {reviewedCount} reviewed hidden</span>
                )}
                {hideCurrentMonth && currentMonthCount > 0 && (
                  <span className="text-xs text-neutral-400">
                    · {currentMonthCount} this month hidden
                  </span>
                )}
              </div>
              {(reviewedCount > 0 || currentMonthCount > 0) && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {reviewedCount > 0 && (
                    <Toggle
                      checked={!hideReviewed}
                      onChange={() => setHideReviewed((v) => !v)}
                      label={c("recode.toggle.showReviewed")}
                    />
                  )}
                  {currentMonthCount > 0 && (
                    <Toggle
                      checked={!hideCurrentMonth}
                      onChange={() => setHideCurrentMonth((v) => !v)}
                      label={c("recode.toggle.showThisMonth")}
                    />
                  )}
                </div>
              )}
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold">{money(total)}</span>
          </div>

          {/* The list scrolls inside itself on the workbench layout, so the two
              docked columns beside it stay put while you work down the queue. */}
          <ul className="space-y-2 xl:max-h-[calc(100dvh-13rem)] xl:overflow-y-auto xl:pr-1">
            {visible.map((b) => {
              // Each bill carries its own job — this list spans every job, and
              // the bill view needs it to load the right budget/CTC.
              const billJobId = (b.jobId ?? "").trim();
              const f = flagged(b);
              const active = wide && b.id === selId;
              return (
                <li key={b.id} id={`draft-row-${b.id}`}>
                  <RowShell
                    // From xl up the coding panel is on screen, so a row PICKS a
                    // bill — a real button, not a link, or the unsaved-changes
                    // guard would fire its "leaving the page" confirm on top of
                    // this one's. Below xl the bill has nowhere to open here, so
                    // the row is the link to its own page it has always been.
                    wide={wide}
                    active={active}
                    href={`/bill/${b.id}?jobId=${encodeURIComponent(billJobId)}&from=drafts`}
                    onNavigate={() => driveMainWindowToDoc(billJobId, b.id)}
                    onSelect={() => select(b.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium">{billTitle(b)}</div>
                          <BillStatusBadge status={b.status} />
                          {f.reviewed ? (
                            <span
                              title="Marked reviewed in the Assistant"
                              className="inline-block shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                            >
                              ✓ Reviewed
                            </span>
                          ) : f.saved ? (
                            <span
                              title="Save has been clicked on this bill"
                              className="inline-block shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              ✓ Saved
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-neutral-500">
                          {b.jobName
                            ? b.jobName
                            : b.subject && b.subject !== billTitle(b)
                              ? b.subject
                              : b.id}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold">{money(billAmount(b))}</div>
                        <div className="text-xs text-neutral-500">{b.issueDate || ""}</div>
                      </div>
                    </div>
                  </RowShell>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li>
                <EmptyState>
                  {bills.length === 0
                    ? c("recode.empty.noDrafts")
                    : hideReviewed && hideCurrentMonth
                      ? c("recode.empty.allFiltered")
                      : hideReviewed
                        ? c("recode.empty.allReviewed")
                        : c("recode.empty.allThisMonth")}
                </EmptyState>
              </li>
            )}
          </ul>
        </>
      )}
    </>
  );

  return (
    // One column on a phone (the list alone), three from xl — the same
    // Budget | bills | Coding shape as the job workbench, and the same docked
    // side columns. `self-start` is what lets a sticky grid item scroll within
    // its row instead of being stretched to the row's full height.
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <section className="hidden min-w-0 xl:block xl:sticky sticky-below-header xl:self-start">
        <DraftBudgetRail editor={editor} sel={sel} />
      </section>

      <section className="min-w-0">{list}</section>

      <section className="hidden min-w-0 xl:block xl:sticky sticky-below-header xl:self-start">
        <DraftCodingPanel
          editor={editor}
          sel={sel}
          position={selIdx + 1}
          count={visible?.length ?? 0}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onBillMoved={dropBill}
        />
      </section>
    </div>
  );
}
