"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { JtLink } from "@/components/JtLink";
import { billPaidState, driveMainWindowToDoc, money } from "@/components/BillingSummary";
import { Banner, Card, Chip, EmptyState, Label, Loading, SectionLabel, inputCls } from "@/components/ui";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { monthOptions } from "./Roster";
import {
  DraftBudgetRail,
  DraftCodingPanel,
  useBillEditor,
  useIsWide,
  type Selection,
} from "./DraftWorkbench";

/**
 * Tracking Sheets with NO job selected — every vendor bill issued in the
 * selected month, across ALL jobs, as one flat list (newest first). It replaces
 * the per-job roster here: the office asked to see the month's bills themselves,
 * not a list of jobs to drill into.
 *
 * From the `xl` breakpoint up this becomes a two-pane workbench — the list on
 * the left (three columns counting the budget rail), the selected bill's own
 * coding card on the right — the same Budget | bills | Coding shape the
 * needs-coding queue uses (DraftWorkbench.tsx), reused as-is: each bill still
 * carries its own job, so the side columns load that job's budget per
 * selection rather than one shared budget. Below `xl` there's no room for a
 * third column, so a row instead opens the bill's own full page.
 */

interface AllBill {
  id: string;
  vendor: string;
  cost: number;
  issueDate: string;
  createdAt: string;
  status: string;
  invoiced: boolean;
  /** Paid-in-QuickBooks figures JobTread computes — read as a pair, see billPaidState. */
  amountPaid: number;
  balance: number;
  needsReview: boolean;
  jobId: string;
  jobName: string;
  customerName: string;
}

const jobLabel = (b: AllBill) =>
  [b.customerName, b.jobName].filter(Boolean).join(" — ") || "no job";

/** Sunset Builders Supply, matched the same way the job board does (`/sunset/i`
 *  on the vendor name) — its high invoice count is noise, so it folds into its
 *  own collapsible pane here too. */
const isSunsetVendor = (vendor: string) => /sunset/i.test(vendor);

/** "2026-08-14" or "2026-08-14T09:…Z" → "Aug 14". Takes the date part only, as
 *  plain Y-M-D — no timezone shift. */
const shortDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso || "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function AllBills({ ym, setYm }: { ym: string; setYm: (ym: string) => void }) {
  const [bills, setBills] = useState<AllBill[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Sunset folds into its own collapsible pane, collapsed by default — same as
  // the per-job board.
  const [sunsetOpen, setSunsetOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const [y, m] = ym.split("-");
    setLoading(true);
    setError("");
    // Always show the whole month: draft, uninvoiced, and already-invoiced bills
    // alike, each tagged with its state below.
    fetch(
      `/api/trackingsheet/all-bills?year=${y}&month=${Number(m)}&includeDrafts=1&includeInvoiced=1`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) setError(j.error);
        else setBills((j.bills ?? []) as AllBill[]);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ym]);

  // The headline figure is what's still TO BE INVOICED this month, so it stays
  // stable as the list grows: an already-invoiced bill is done, and a draft
  // isn't invoiceable until it's approved — JobTread won't pull either onto a
  // customer invoice. So only committed, uninvoiced bills (the ones tagged
  // "uninvoiced") count toward it, even though the list shows every bill.
  const toBeInvoiced = useMemo(
    () =>
      (bills ?? [])
        .filter((b) => !b.invoiced && b.status !== "draft")
        .reduce((s, b) => s + b.cost, 0),
    [bills],
  );
  const monthLabel = monthOptions().find((o) => o.ym === ym)?.label ?? ym;

  // The list split in two, same as the job board: everything else in the main
  // list, Sunset in its own collapsible pane at the bottom.
  const nonSunsetBills = useMemo(
    () => (bills ?? []).filter((b) => !isSunsetVendor(b.vendor)),
    [bills],
  );
  const sunsetBills = useMemo(
    () => (bills ?? []).filter((b) => isSunsetVendor(b.vendor)),
    [bills],
  );
  const sunsetTotal = useMemo(() => sunsetBills.reduce((s, b) => s + b.cost, 0), [sunsetBills]);

  // ---- the coding workbench (xl and up) ------------------------------------

  const wide = useIsWide();
  const [selId, setSelId] = useState("");

  // Visual order — main list then the Sunset pane — so ‹ Prev / Next › steps
  // the same way the eye reads the page.
  const orderedBills = useMemo(() => [...nonSunsetBills, ...sunsetBills], [nonSunsetBills, sunsetBills]);
  const selIdx = orderedBills.findIndex((b) => b.id === selId);
  const selBill = selIdx >= 0 ? orderedBills[selIdx] : null;
  const sel: Selection | null = selBill
    ? { docId: selBill.id, jobId: selBill.jobId, label: selBill.vendor, jobName: jobLabel(selBill) }
    : null;

  const editor = useBillEditor(sel);

  // The panel's edits are staged in the browser until Save.
  useUnsavedChanges(
    editor.changeCount > 0,
    "This bill has unsaved coding changes. Leave without saving? Your changes will be lost.",
  );

  // A month change loads a whole new list — the old selection no longer applies.
  useEffect(() => {
    setSelId("");
  }, [ym]);

  /** Move the panel to another bill, keeping unsaved work from vanishing silently. */
  const select = useCallback(
    (id: string) => {
      if (id === selId) return;
      if (
        editor.changeCount > 0 &&
        !window.confirm("This bill has unsaved coding changes. Discard them and open the next bill?")
      )
        return;
      setSelId(id);
      const b = orderedBills.find((x) => x.id === id);
      if (b) driveMainWindowToDoc(b.jobId, b.id);
    },
    [selId, editor.changeCount, orderedBills],
  );

  const step = (delta: number) => {
    if (selIdx < 0) return;
    const next = orderedBills[selIdx + delta];
    if (next) select(next.id);
  };

  /** The bill was re-filed onto another job — JobTread deleted and recreated
   *  it elsewhere, so this row is stale. */
  const dropBill = useCallback((docId: string) => {
    setBills((prev) => (prev ? prev.filter((b) => b.id !== docId) : prev));
  }, []);

  // Land on the first bill so the workbench opens ready to work, rather than
  // with an empty panel. Desktop only, and once per month load.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    didAutoSelect.current = false;
  }, [ym]);
  useEffect(() => {
    if (!wide || didAutoSelect.current || orderedBills.length === 0) return;
    didAutoSelect.current = true;
    setSelId(orderedBills[0].id);
  }, [wide, orderedBills]);

  // One bill's card — shared by the main list and the Sunset pane. From `xl`
  // up, tapping a bill SELECTS it (the coding panel is on screen); below that
  // it's a plain link to the bill's own page, same as before.
  const renderBillCard = (b: AllBill) => {
    const active = wide && b.id === selId;
    const paid = billPaidState(b);
    const body = (
      <>
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-semibold">{b.vendor}</span>
          <span className="shrink-0 text-base font-semibold tabular-nums">{money(b.cost)}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
          {jobLabel(b)}
          {b.createdAt ? ` · added ${shortDate(b.createdAt)}` : ""}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5 empty:mt-0">
          {/* Leads the row and rendered in red — a flagged bill is the one the
              office needs to act on, so it must be impossible to miss. */}
          {b.needsReview && (
            <Chip tone="danger" title="Flagged for a billing correction — open the bill to see the note">
              ⚑ Needs review
            </Chip>
          )}
          {b.status === "draft" && <Chip tone="neutral">draft</Chip>}
          {b.invoiced ? (
            <Chip tone="info" title="Already on a customer invoice — read-only">
              invoiced
            </Chip>
          ) : (
            b.status !== "draft" && (
              <Chip tone="neutral" title="Not yet on a customer invoice">
                uninvoiced
              </Chip>
            )
          )}
          {/* Paid = money recorded against the bill in QuickBooks. It is a
              different axis from "invoiced" (what the CLIENT has been billed),
              so both chips can sit on one row. */}
          {paid === "paid" && (
            <Chip tone="success" title={`Paid in full — ${money(b.amountPaid)} recorded in QuickBooks`}>
              ✓ paid
            </Chip>
          )}
          {paid === "partial" && (
            <Chip tone="warning" title={`${money(b.amountPaid)} paid · ${money(b.balance)} still owed`}>
              part paid
            </Chip>
          )}
        </span>
      </>
    );

    return (
      <li key={b.id} id={`allbills-row-${b.id}`}>
        <Card
          pad={false}
          className={`flex items-stretch overflow-hidden ${
            active
              ? "ring-2 ring-accent"
              : b.needsReview
                ? "ring-2 ring-red-400 dark:ring-red-500/70"
                : ""
          }`}
        >
          {/* Status as a 3px edge stripe, same as the job board:
              red = flagged for review (outranks everything — it's the thing to
              act on), amber = draft, blue = already invoiced. */}
          <span
            aria-hidden
            className={`shrink-0 ${b.needsReview ? "w-[5px] bg-red-500" : "w-[3px]"} ${
              b.needsReview
                ? ""
                : b.invoiced
                  ? "bg-sky-500"
                  : b.status === "draft"
                    ? "bg-amber-500"
                    : "bg-transparent"
            }`}
          />
          {wide ? (
            <button
              type="button"
              onClick={() => select(b.id)}
              aria-current={active ? "true" : undefined}
              className="min-w-0 flex-1 p-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
            >
              {body}
            </button>
          ) : (
            <Link
              href={`/bill/${b.id}?jobId=${encodeURIComponent(b.jobId)}`}
              className="min-w-0 flex-1 p-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
            >
              {body}
            </Link>
          )}
          <span className="flex shrink-0 items-start border-l border-line-soft">
            <JtLink
              href={`https://app.jobtread.com/jobs/${b.jobId}/documents/${b.id}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-xs font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
            >
              JT ↗
            </JtLink>
          </span>
        </Card>
      </li>
    );
  };

  return (
    <>
      <div className="mb-3">
        <Label htmlFor="allbills-month">Billing month</Label>
        <select
          id="allbills-month"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className={inputCls}
        >
          {monthOptions().map((o) => (
            <option key={o.ym} value={o.ym}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <Loading label="Loading this month’s bills…" />}

      {!loading && !error && (
        // One column on a phone (the list alone), three from xl — the same
        // Budget | bills | Coding shape as the job workbench and the
        // needs-coding queue. `self-start` is what lets a sticky grid item
        // scroll within its row instead of stretching to the row's height.
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="hidden min-w-0 xl:block xl:sticky xl:top-16 xl:self-start">
            <DraftBudgetRail editor={editor} sel={sel} />
          </section>

          <section className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <SectionLabel>
                {`${(bills ?? []).length} bill${(bills ?? []).length === 1 ? "" : "s"}`} ·{" "}
                {money(toBeInvoiced)} to invoice
              </SectionLabel>
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                {monthLabel} · all jobs
              </span>
            </div>

            {(bills ?? []).length === 0 ? (
              <EmptyState>No bills issued in {monthLabel}.</EmptyState>
            ) : (
              <>
                {/* The list scrolls inside itself on the workbench layout, so
                    the two docked side columns stay put while you work down
                    the month. */}
                {nonSunsetBills.length > 0 && (
                  <ul className="space-y-2 xl:max-h-[calc(100dvh-13rem)] xl:overflow-y-auto xl:pr-1">
                    {nonSunsetBills.map(renderBillCard)}
                  </ul>
                )}

                {/* Sunset folded into its own collapsible pane, same treatment
                    as the per-job board: pushed to the bottom, collapsed by
                    default, with a count and total. */}
                {sunsetBills.length > 0 && (
                  <Card pad={false} className="mt-2 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSunsetOpen((v) => !v)}
                      aria-expanded={sunsetOpen}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5 lg:py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold">
                        <span
                          aria-hidden
                          className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
                            sunsetOpen ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        Sunset ({sunsetBills.length} bill{sunsetBills.length === 1 ? "" : "s"})
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {money(sunsetTotal)}
                      </span>
                    </button>
                    {sunsetOpen && (
                      <ul className="space-y-2 border-t border-line-soft bg-neutral-50 p-2 dark:bg-ink-raised/50">
                        {sunsetBills.map(renderBillCard)}
                      </ul>
                    )}
                  </Card>
                )}
              </>
            )}
          </section>

          <section className="hidden min-w-0 xl:block xl:sticky xl:top-16 xl:self-start">
            <DraftCodingPanel
              editor={editor}
              sel={sel}
              position={selIdx + 1}
              count={orderedBills.length}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onBillMoved={dropBill}
            />
          </section>
        </div>
      )}
    </>
  );
}
