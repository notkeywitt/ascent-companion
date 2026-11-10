"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { JobOverview } from "@/components/HomeJobBoard";
import { HomeTodos } from "@/components/HomeTodos";
import { NotesPanel, type NoteRequest } from "@/components/NotesPanel";
import type { Note, NoteBill } from "@/lib/notes";
import { TodayOfficeTodos } from "@/components/TodayOfficeTodos";
import { TodayQueue } from "@/components/TodayQueue";
import { WORKING_PHASES } from "@/components/JobPicker";
import { Donut } from "@/components/Donut";
import { LopezMap } from "@/components/LopezMap";
import { Card, Loading, Segmented, Select, Skeleton, btn } from "@/components/ui";
import { Board } from "@/app/trackingsheet/Board";
import { JobCard } from "@/app/job-board/JobBoardPage";
import { ClientsBrowser } from "@/app/clients/ClientsBrowser";
import { CustomerPopup } from "@/app/clients/CustomerPopup";
import Link from "next/link";
import { DraftInvoicingEmail } from "@/components/PackageEmail";
import { SyncAllTrackingSheetsFor } from "@/components/TrackingSheetSync";
import { BudgetImport } from "@/app/budget-import/BudgetImport";
import { Specs } from "@/app/specs/Specs";
import { HouseManualPage } from "@/app/house-manual/HouseManual";
import { monthJobRows, monthWarrantyRow, useMonthJobs } from "@/app/trackingsheet/MonthJobDonuts";
import { WARRANTY_SLICE_KEY } from "@/lib/warranty";
import { billingMonths } from "@/lib/billingMonths";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";
import type { MapJob } from "@/lib/lopezMap";
import type { JobsPageCard } from "@/lib/jobBoard";
import { money0 } from "@/lib/money";
import { appScrollTo, appScrollY } from "@/lib/appScroll";

import { JobPhotos, JobPlans, useJobFiles } from "./JobFiles";
import { PunchList } from "./PunchList";

/**
 * Jobs — the desktop screen for every job at once (owner, 2026-11-01; the
 * Figma page is "Jobs — header v2" in "Ascent — Jobs Hub (desktop draft)").
 *
 *   • At the top, the header: two cards (owner, 2026-11-01). The jobs list,
 *     by phase, "Customer - Job" A–Z by last name, each with its month total,
 *     under the month picker. Beside it, the picked job's Job Board card with
 *     the Lopez Island map in its top right — or, with no job picked, the
 *     month's totals beside the map. Under them, a row of a picked job's tabs.
 *   • Under the header: no job → Home's "Needs you" queue and to-dos; a job →
 *     the picked tab: Tracking sheet (the job's /trackingsheet, embedded whole
 *     but for its tabs and header), Schedule (the job's overview),
 *     Plans or Photos (the job's JobTread plan sheets and photos), or Punch
 *     List (the final inspection checklist, ticked off per job).
 *
 * A list row or a map dot picks the job; picking it again closes it.
 *
 * Every write is an embedded page's own; the Punch List writes only the
 * companion DB.
 */

type HubJob = MapJob & { customer?: string | null };
type Tab = "sheet" | "schedule" | "plans" | "photos" | "punch" | "record" | "budget" | "specs" | "manual";

/** Ascent's own jobs — customer "Ascent" (Office, Shop, Electrical) — stay out of
 *  the list and the totals: overhead, not client work (owner, 2026-11-01). */
const isAscentOwn = (customer: string | null | undefined) =>
  (customer ?? "").trim().toLowerCase() === "ascent";
const jobLabel = (j: HubJob) => (j.customer ? `${j.customer} - ${j.name}` : j.name);
/**
 * The customer's sort name: the last word ("Kevin Berger" → Berger, "Bill and
 * Denise Dougall-Jackins" → Dougall-Jackins), or a company's first word
 * ("Moon Spring Farm LLC" → Moon). ponytail: a company without a suffix sorts
 * by its last word.
 */
const sortName = (customer: string | null | undefined) => {
  const w = (customer ?? "").trim().split(/\s+/);
  const last = w[w.length - 1] ?? "";
  return (/^(llc|inc|co|corp|ltd)\.?$/i.test(last) ? w[0] : last).toLowerCase();
};

/** The list's phase order: PreCon Budget before PreCon (owner, 2026-11-01). */
const LIST_PHASES = ["Active", "PreCon Budget", "PreCon"];

const caption =
  "text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400";

export function JobsHub() {
  const { can } = useAccess();
  const canTrackingSheet = can("recode");
  const [jobs, setJobs] = useState<HubJob[] | null>(null);
  const [defaultYm, setDefaultYm] = useState("");
  /** The Job Board's cards, by job id — address, number, schedule span, to-dos. */
  const [details, setDetails] = useState<Map<string, JobsPageCard> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The job whose customer the pop-up shows (owner, 2026-11-02). */
  const [customerOf, setCustomerOf] = useState<string | null>(null);
  /** The list row under the pointer: its dot lights on the map meanwhile. */
  const [hoverId, setHoverId] = useState<string | null>(null);
  // A ring slice lit a row the list may have scrolled past: bring it into view.
  useEffect(() => {
    if (hoverId)
      document
        .querySelector(`[data-job="${CSS.escape(hoverId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [hoverId]);
  const [tab, setTab] = useState<Tab>(canTrackingSheet ? "sheet" : "schedule");
  /** Where the Tracking sheet draws its to-be-invoiced figure and rings: the
   *  job card, beside the map (owner, 2026-11-01). */
  const [summarySlot, setSummarySlot] = useState<HTMLElement | null>(null);
  /** …and the rings' month / job-to-date switch, under the month picker. */
  const [scopeSlot, setScopeSlot] = useState<HTMLElement | null>(null);
  /** …and the rings alone, in the card's own column (owner, 2026-11-06). */
  const [ringsSlot, setRingsSlot] = useState<HTMLElement | null>(null);
  /** The rings' scope. All Time has no month, so the month picker and the
   *  month's Sync hide then (owner, 2026-11-02). A new board starts on This
   *  Month, so a new job or month does too. */
  const [ringScope, setRingScope] = useState<"month" | "job">("month");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((d) => !cancelled && setJobs(d.error ? [] : (d.jobs ?? [])))
      .catch(() => !cancelled && setJobs([]));
    fetch("/api/job-board")
      .then((r) => r.json())
      .then(
        (d: {
          error?: string;
          active?: JobsPageCard[];
          precon?: JobsPageCard[];
          complete?: JobsPageCard[];
        }) => {
          if (cancelled) return;
          const all = [...(d.active ?? []), ...(d.precon ?? []), ...(d.complete ?? [])];
          setDetails(new Map(all.map((c) => [c.id, c])));
        },
      )
      .catch(() => !cancelled && setDetails(new Map()));
    // Only for the billing month's name: the month the rings open on.
    fetch("/api/jobs/to-be-invoiced")
      .then((r) => r.json())
      .then((d) => !cancelled && !d?.error && setDefaultYm(d.ym ?? ""))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The month: the billing month until someone picks another.
  const [pickedYm, setPickedYm] = useState<string | null>(null);
  const ym = pickedYm ?? defaultYm;
  const months = useMemo(() => billingMonths(), []);
  // No outline: it sits in the card's top right corner, a word you can change
  // (owner, 2026-11-01).
  const monthSelect = (
    <select
      aria-label="Month"
      value={ym}
      onChange={(e) => setPickedYm(e.target.value)}
      className="cursor-pointer rounded-md bg-transparent py-1 text-right text-[13px] font-semibold text-neutral-600 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 dark:text-neutral-300"
    >
      {months.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
  // Bumped when the open job's figure changes, so the list re-reads the month.
  const [monthRefresh, setMonthRefresh] = useState(0);
  const refreshMonth = useCallback(() => setMonthRefresh((n) => n + 1), []);
  const { jobs: monthJobs } = useMonthJobs(ym, monthRefresh);

  // Each client job's month: bills and labor, sales tax and warranty out.
  const ranked = useMemo(
    () =>
      monthJobs
        ? twoFamilies(monthJobRows(monthJobs.filter((j) => !isAscentOwn(j.customerName))))
        : null,
    [monthJobs],
  );
  const byJob = useMemo(() => new Map((ranked ?? []).map((r) => [r.key, r])), [ranked]);
  // The all-jobs rings: every client job, plus the month's warranty work on
  // those jobs as one grey slice — in the month's total, on no job.
  const ringItems = useMemo(() => {
    if (!ranked || !monthJobs) return ranked;
    const w = monthWarrantyRow(monthJobs.filter((j) => !isAscentOwn(j.customerName)));
    return w ? [...ranked, { ...w, laborColor: w.color }] : ranked;
  }, [ranked, monthJobs]);
  // The list: every working client job, and any other with cost this month.
  const listed = useMemo(
    () =>
      (jobs ?? [])
        .filter(
          (j) =>
            !isAscentOwn(j.customer) && (WORKING_PHASES.includes(j.phase ?? "") || byJob.has(j.id)),
        )
        .sort(
          (a, b) =>
            sortName(a.customer).localeCompare(sortName(b.customer)) ||
            jobLabel(a).localeCompare(jobLabel(b)),
        ),
    [jobs, byJob],
  );
  // Grouped by phase: the working phases in their usual order, then any other
  // phase a job with cost this month is in, A–Z (owner, 2026-11-01).
  const byPhase = useMemo(() => {
    const groups = new Map<string, HubJob[]>();
    for (const j of listed) {
      const p = j.phase || "No phase";
      groups.set(p, [...(groups.get(p) ?? []), j]);
    }
    const rank = (p: string) => {
      const i = LIST_PHASES.indexOf(p);
      return i < 0 ? LIST_PHASES.length : i;
    };
    return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [listed]);

  // The jobs a new note can be tagged with while no job is picked.
  const noteJobs = useMemo(() => listed.map((j) => ({ id: j.id, label: jobLabel(j) })), [listed]);
  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  /** A linked bill clicked in a note: the board opens it and scrolls to it. */
  const [focusBill, setFocusBill] = useState<{ docId: string; label: string; nonce: number } | null>(null);
  /** Bills the picked job has notes on (bill id → newest note id), for the bill rows' Note link. */
  const [noteDocs, setNoteDocs] = useState<Map<string, number>>(new Map());
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(null);
  const onJobNotes = (notes: Note[]) => {
    const m = new Map<string, number>();
    // Newest first, so the first note seen for a bill is its newest.
    for (const n of notes) for (const b of n.bills) if (!m.has(b.docId)) m.set(b.docId, n.id);
    setNoteDocs(m);
  };
  const onBillNote = (bill: { docId: string; label: string }, noteId?: number) => {
    const nonce = Date.now();
    setNoteRequest(
      noteId !== undefined
        ? { nonce, kind: "show", noteId }
        : { nonce, kind: "add", bill: { docId: bill.docId, label: bill.label, jobId: selectedId ?? undefined } },
    );
  };
  // Go to the bill's job and the note's billing month, on the Tracking sheet
  // tab, and ask the board for the bill. False = this page cannot show it (no
  // Tracking sheet, or a job not in the list), so the link opens normally.
  const openBill = (note: Note, bill: NoteBill): boolean => {
    const jid = bill.jobId || note.jobId;
    if (!canTrackingSheet || !jid || !jobs?.some((j) => j.id === jid)) return false;
    if ((jid !== selectedId || tab !== "sheet") && !confirmLeaveIfDirty()) return true;
    if (note.billingYm) setPickedYm(note.billingYm);
    setSelectedId(jid);
    setTab("sheet");
    setFocusBill({ docId: bill.docId, label: bill.label, nonce: Date.now() });
    return true;
  };
  // A bill link (/bill/<id> sends here as ?bill=<id>&jobId=…): read the bill
  // for its job and billing month, then open it like a note's bill. A bill
  // this page cannot show (no job, no Tracking sheet) goes to its own page.
  const [linkedBill, setLinkedBill] = useState<{ docId: string; jobId: string; ym: string; label: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const docId = q.get("bill");
    if (!docId) return;
    window.history.replaceState(null, "", window.location.pathname);
    const fallback = () =>
      window.location.replace(
        `/bill/${encodeURIComponent(docId)}?page=1${q.get("jobId") ? `&jobId=${encodeURIComponent(q.get("jobId")!)}` : ""}`,
      );
    fetch(`/api/bill?docId=${encodeURIComponent(docId)}`)
      .then((r) => r.json())
      .then((d: { error?: string; jobId?: string; header?: { issueDate?: string; vendorName?: string; number?: string } }) => {
        if (d.error || !d.jobId) return fallback();
        const label = [d.header?.vendorName, d.header?.number && `#${d.header.number}`].filter(Boolean).join(" ") || "Bill";
        setLinkedBill({ docId, jobId: d.jobId, ym: (d.header?.issueDate ?? "").slice(0, 7), label });
      })
      .catch(fallback);
  }, []);
  useEffect(() => {
    if (!linkedBill || !jobs) return;
    setLinkedBill(null);
    if (!canTrackingSheet || !jobs.some((j) => j.id === linkedBill.jobId)) {
      window.location.replace(`/bill/${encodeURIComponent(linkedBill.docId)}?page=1`);
      return;
    }
    if (/^\d{4}-\d{2}$/.test(linkedBill.ym)) setPickedYm(linkedBill.ym);
    setSelectedId(linkedBill.jobId);
    setTab("sheet");
    setFocusBill({ docId: linkedBill.docId, label: linkedBill.label, nonce: Date.now() });
  }, [linkedBill, jobs, canTrackingSheet]);
  // A new job or tab unmounts the view under the header, so an embedded page's
  // unsaved edits (the House Manual) would go without a word. Ask first.
  const pick = (id: string) => {
    if (!confirmLeaveIfDirty()) return;
    setSelectedId((cur) => (cur === id ? null : id));
  };
  const files = useJobFiles(selected && (tab === "plans" || tab === "photos") ? selected.id : null);

  // Switching tabs swaps a tall view for one still loading, so the page would
  // shrink and the browser pull the view up. Hold the page at its height
  // through the switch and put the scroll back; a new job lets go.
  const mainRef = useRef<HTMLElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  const switchTab = (t: Tab) => {
    if (t === tab || !confirmLeaveIfDirty()) return;
    const y = appScrollY();
    setHeldHeight(mainRef.current?.offsetHeight);
    setTab(t);
    requestAnimationFrame(() => appScrollTo(y));
  };
  useEffect(() => setHeldHeight(undefined), [selectedId]);

  // The map, right of the cards, the full height of the row the list sets,
  // with little room around the island (owner, 2026-11-01).
  const map = (
    <div className="h-full w-full [&_svg]:min-h-0 [&_svg]:flex-1">
      {jobs ? (
        <LopezMap
          jobs={jobs}
          selectedId={hoverId ?? selectedId}
          focusId={selectedId}
          onSelect={pick}
          legend={false}
          pad={6}
          className="h-full"
        />
      ) : (
        <Loading />
      )}
    </div>
  );

  const tabs = (
    <Segmented
      label="Show"
      value={tab}
      onChange={switchTab}
      options={[
        ...(canTrackingSheet ? [{ value: "sheet" as const, label: "Tracking sheet" }] : []),
        { value: "schedule" as const, label: "Schedule" },
        { value: "plans" as const, label: "Plans" },
        { value: "photos" as const, label: "Photos" },
        { value: "punch" as const, label: "Punch List" },
        // The job's own pages, drawn here instead of opened (owner, 2026-11-02).
        // Each shows only to someone who holds its view.
        ...(can("clients") ? [{ value: "record" as const, label: "Job Details" }] : []),
        ...(can("budget-import") ? [{ value: "budget" as const, label: "Budget Import" }] : []),
        ...(can("specs") ? [{ value: "specs" as const, label: "Specifications" }] : []),
        ...(can("house-manual") ? [{ value: "manual" as const, label: "House Manual" }] : []),
      ]}
    />
  );

  useEffect(() => setRingScope("month"), [selectedId, ym]);
  const allTimeOn = !!selectedId && tab === "sheet" && ringScope === "job";
  // One row — the rings' scope switch, then the month.
  const monthControls = (
    <div className="flex items-center gap-3">
      {selected && tab === "sheet" && <div ref={setScopeSlot} />}
      {!allTimeOn && monthSelect}
    </div>
  );

  return (
    <main
      ref={mainRef}
      className="w-full px-4 pb-10 pt-5 pad:px-7"
      style={{ minHeight: heldHeight }}
    >
      <div className="min-w-0 space-y-6">
        {/* THE HEADER (owner, 2026-11-01): two cards — the jobs list, and the
            picked job's Job Board card with the map in its top right (the
            month's totals beside the map while no job is picked). */}
        <div className="grid gap-6 max-2xl:landscape:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] max-2xl:landscape:grid-rows-[360px_auto] 2xl:h-[360px] 2xl:grid-cols-[320px_minmax(0,1fr)_280px] 2xl:grid-rows-[minmax(0,1fr)]">
          {/* The row is 360px (owner, 2026-11-01); the list scrolls inside it.
              From 2xl the list, card and map share it. Below 2xl, held
              sideways, the list (3/5) and the map (2/5) share it and the card
              spans the row under them: at xl the card was too narrow and its
              footer covered the notes (owner, 2026-11-10).
              A phone or iPad held upright picks from the dropdown over the map instead. */}
          <Card pad={false} className="hidden min-h-0 min-w-0 flex-col overflow-hidden p-3 landscape:flex 2xl:flex max-2xl:landscape:col-start-1 max-2xl:landscape:row-start-1">
            {!jobs && <Loading />}
            <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto">
              {byPhase.map(([phase, list]) => (
                <section key={phase}>
                  <div className={`px-2 pb-0.5 ${caption}`}>{phase}</div>
                  <ul className="space-y-px">
                    {list.map((j) => {
                      const r = byJob.get(j.id);
                      return (
                        <li key={j.id}>
                          <button
                            type="button"
                            onClick={() => pick(j.id)}
                            data-job={j.id}
                            onMouseEnter={() => setHoverId(j.id)}
                            onMouseLeave={() => setHoverId(null)}
                            aria-pressed={j.id === selectedId}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-line-soft ${j.id === selectedId ? "bg-accent/10 font-semibold shadow-[inset_3px_0_0_rgb(var(--accent))]" : j.id === hoverId ? "bg-line-soft" : ""}`}
                          >
                            <span className="min-w-0 flex-1 truncate">{jobLabel(j)}</span>
                            <span className="shrink-0 text-[12px] font-normal tabular-nums text-neutral-500 dark:text-neutral-400">
                              {r && r.bills + r.labor > 0 ? money0(r.bills + r.labor) : "—"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </Card>

          {/* The second card, with the month picker in its top right corner. */}
          {/* A phone puts the month controls in a row above the card: laid
              over its corner they covered the rings (owner, 2026-11-03). */}
          <div className="relative flex min-h-0 min-w-0 flex-col gap-3 pad:block max-2xl:landscape:col-span-2 max-2xl:landscape:row-start-2">
            {selected ? (
              details?.get(selected.id) ? (
                <JobCard
                  c={details.get(selected.id)!}
                  nameLink={false}
                  onCustomer={can("clients") ? () => setCustomerOf(selected.id) : undefined}
                  // Sync at the card's foot, clear of the notes (owner, 2026-11-06).
                  footer={
                    ym && !allTimeOn ? (
                      <div className="flex flex-wrap items-start justify-center gap-2">
                        <DraftInvoicingEmail ym={ym} />
                        <SyncAllTrackingSheetsFor ym={ym} className="text-center" />
                        {can("invoice-review") && (
                          <Link
                            href={`/invoice-review?ym=${encodeURIComponent(ym)}`}
                            className={btn("secondary", "md", "min-h-11")}
                          >
                            Check All Jobs
                          </Link>
                        )}
                      </div>
                    ) : undefined
                  }
                  hub={{
                    total:
                      tab === "sheet" && canTrackingSheet ? <div ref={setSummarySlot} /> : undefined,
                    controls: monthControls,
                    rings:
                      tab === "sheet" && canTrackingSheet ? <div ref={setRingsSlot} /> : undefined,
                    // The job's notes: only this job's, newest first.
                    notes: (
                      <NotesPanel
                        jobId={selected.id}
                        jobLabel={jobLabel(selected)}
                        ym={ym}
                        jobs={noteJobs}
                        hideHeading
                        onOpenBill={openBill}
                        onNotes={onJobNotes}
                        request={noteRequest}
                        className="min-h-48 flex-1 2xl:min-h-0"
                      />
                    ),
                  }}
                />
              ) : details ? (
                <Card />
              ) : (
                <Skeleton className="h-40 w-full rounded-xl" />
              )
            ) : (
              // The list's height, with the tabs on their own row at the foot.
              <Card className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
                <div className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto">
                  {ringItems ? (
                    // The rings, then the month's notes in the space beside
                    // them (owner, 2026-11-06). The notes scroll on their own.
                    <div className="flex h-full min-h-0 flex-col gap-6 pad:flex-row">
                      <MonthRings
                        items={ringItems}
                        onSelect={(id) => id !== WARRANTY_SLICE_KEY && pick(id)}
                        onHover={(id) => setHoverId(id === WARRANTY_SLICE_KEY ? null : id)}
                      />
                      <NotesPanel
                        jobId={null}
                        ym={ym}
                        jobs={noteJobs}
                        onOpenBill={openBill}
                        className="min-h-48 pad:h-full pad:min-w-[280px] pad:flex-1 pad:pt-10"
                      />
                    </div>
                  ) : (
                    <Skeleton className="h-48 w-full rounded-xl" />
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-start justify-center gap-2 border-t border-line-soft pt-3">
                  {/* The month's actions, for the month picked above. */}
                  <DraftInvoicingEmail ym={ym} />
                  <SyncAllTrackingSheetsFor ym={ym} />
                  {can("invoice-review") && (
                    <Link
                      href={`/invoice-review?ym=${encodeURIComponent(ym)}`}
                      className={btn("secondary", "md", "min-h-11")}
                    >
                      Check All Jobs
                    </Link>
                  )}
                </div>
              </Card>
            )}
            {/* A picked job's card carries these in its head row (owner, 2026-11-06). */}
            {!selected && (
              <div className="order-first flex items-center justify-end gap-4 pad:absolute pad:right-4 pad:top-3 pad:z-10">
                {monthControls}
              </div>
            )}
          </div>
          {/* The map, on the page beside the cards (owner, 2026-11-01). Below
              2xl, held sideways, it shares the top row with the jobs list and the
              job card spans the row under them. Held upright, the map comes
              first, short enough to fit the screen, with the jobs dropdown
              under it (owner, 2026-11-06). */}
          <div className="order-first flex min-h-0 flex-col gap-3 landscape:order-none 2xl:order-none max-2xl:landscape:col-start-2 max-2xl:landscape:row-start-1">
            <Select
              aria-label="Job"
              value={selectedId ?? ""}
              disabled={!jobs}
              // "All jobs" closes the open job: pick() toggles it off.
              onChange={(e) => {
                const id = e.target.value || selectedId;
                if (id) pick(id);
              }}
              className="order-last landscape:hidden 2xl:hidden"
            >
              <option value="">{jobs ? "All jobs" : "Loading jobs…"}</option>
              {byPhase.map(([phase, list]) => (
                <optgroup key={phase} label={phase}>
                  {list.map((j) => {
                    const r = byJob.get(j.id);
                    return (
                      <option key={j.id} value={j.id}>
                        {jobLabel(j)}
                        {r && r.bills + r.labor > 0 ? ` · ${money0(r.bills + r.labor)}` : ""}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </Select>
            <div className="min-h-64 flex-1 landscape:min-h-0 2xl:min-h-0 max-2xl:portrait:h-[min(16rem,35svh)] max-2xl:portrait:min-h-0 max-2xl:portrait:flex-none">{map}</div>
          </div>
        </div>

        {/* A picked job's tabs, a row of their own under the header: at the
            card's foot they ran off a narrow screen (owner, 2026-11-03). Too
            wide still, the row scrolls sideways. */}
        {selected && (
          <div className="no-scrollbar overflow-x-auto">
            <div className="mx-auto w-max">{tabs}</div>
          </div>
        )}

        {/* UNDER THE HEADER */}
        {!selected ? (
          <>
            {/* Home's "Needs you" queue and to-dos; each gates itself by view. */}
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="min-w-0">
                <TodayQueue />
              </div>
              <div className="min-w-0">
                <HomeTodos />
                <TodayOfficeTodos />
              </div>
            </div>
          </>
        ) : tab === "sheet" && canTrackingSheet ? (
          /* The job's Tracking Sheet, as /trackingsheet draws it, less its
             tabs and header. Keyed by job and month: a new pick is a fresh
             board. Staged coding survives it — the board restores unsynced
             work on load and says so. */
          ym && (
            <Suspense fallback={null}>
              <Board key={`${selected.id}-${ym}`} embed={{ jobId: selected.id, ym, summarySlot, ringsSlot, scopeSlot, onFigureChange: refreshMonth, onScopeChange: setRingScope, focusBill, noteDocs, onBillNote }} />
            </Suspense>
          )
        ) : tab === "plans" ? (
          <JobPlans state={files} />
        ) : tab === "photos" ? (
          <JobPhotos state={files} />
        ) : tab === "punch" ? (
          <PunchList key={selected.id} jobId={selected.id} />
        ) : tab === "record" && can("clients") ? (
          <ClientsBrowser key={selected.id} jobId={selected.id} />
        ) : tab === "budget" && can("budget-import") ? (
          <BudgetImport key={selected.id} embedJobId={selected.id} />
        ) : tab === "specs" && can("specs") ? (
          <Suspense fallback={null}>
            <Specs key={selected.id} embedJobId={selected.id} />
          </Suspense>
        ) : tab === "manual" && can("house-manual") ? (
          <Suspense fallback={null}>
            <HouseManualPage key={selected.id} embedJobId={selected.id} />
          </Suspense>
        ) : (
          /* Keyed so a new job starts its own fetch rather than showing the last one's. */
          <JobOverview key={selected.id} jobId={selected.id} />
        )}
      </div>
      {customerOf && (
        <CustomerPopup
          jobId={customerOf}
          onClose={() => setCustomerOf(null)}
          onOpenJob={(id) => {
            if (id !== selectedId) pick(id);
          }}
        />
      )}
    </main>
  );
}

/**
 * The rings' colours (owner, 2026-11-01): Bills warm and Labor cool, so the
 * two rings never read as one — Tableau 20's warm and cool halves, distinct
 * hues that read on the light and the dark card. A job keeps the same slot in
 * both (its rank by the month's total). ponytail: 8 slots per family; colours
 * repeat from the 9th job, and a slice names its job on hover.
 */
const BILL_COLORS = [
  "#F28E2B",
  "#E15759",
  "#EDC948",
  "#FF9D9A",
  "#B6992D",
  "#FFBE7D",
  "#9D7660",
  "#D37295",
];
const LABOR_COLORS = [
  "#4E79A7",
  "#59A14F",
  "#76B7B2",
  "#A0CBE8",
  "#8CD17D",
  "#499894",
  "#B07AA1",
  "#86BCB6",
];
function twoFamilies<T extends { color: string }>(rows: T[]): (T & { laborColor: string })[] {
  return rows.map((r, i) => ({
    ...r,
    color: BILL_COLORS[i % BILL_COLORS.length],
    laborColor: LABOR_COLORS[i % LABOR_COLORS.length],
  }));
}

/**
 * No job picked: the month's Bills ring and Labor ring, a slice per job, with
 * the Total and then Bills · Labor beside them. A slice names its job with its
 * bills and labor on hover, and opens it on a click.
 */
function MonthRings({
  items,
  onSelect,
  onHover,
}: {
  items: {
    key: string;
    label: string;
    bills: number;
    labor: number;
    color: string;
    laborColor: string;
  }[];
  onSelect: (key: string) => void;
  /** The lifted slice's job, lit in the list and on the map meanwhile. */
  onHover: (key: string | null) => void;
}) {
  const detail = (key: string) => {
    const r = items.find((x) => x.key === key);
    return r
      ? [
          { key: "bills", label: "Bills", value: r.bills },
          { key: "labor", label: "Labor", value: r.labor },
        ]
      : [];
  };
  const bills = items.reduce((n, r) => n + r.bills, 0);
  const labor = items.reduce((n, r) => n + r.labor, 0);
  const slices = (field: "bills" | "labor") =>
    items
      .filter((r) => r[field] > 0)
      .map((r) => ({
        key: r.key,
        label: r.label,
        value: r[field],
        color: field === "labor" ? r.laborColor : r.color,
      }));
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-8 pad:self-start">
      <div className="tabular-nums">
        <div className={caption}>All jobs · month</div>
        <div className="mt-1 text-[28px] font-bold leading-tight tracking-tight">
          {money0(bills + labor)}
        </div>
        <div className="text-[13px] text-neutral-500 dark:text-neutral-400">
          Bills {money0(bills)} · Labor {money0(labor)}
        </div>
      </div>
      <div className="flex gap-8">
        <Donut
          title="Bills"
          slices={slices("bills")}
          emptyLabel="No bills"
          size={150}
          legend={false}
          onSelect={onSelect}
          detail={detail}
          onHover={onHover}
        />
        <Donut
          title="Labor"
          slices={slices("labor")}
          emptyLabel="No labor"
          size={150}
          legend={false}
          onSelect={onSelect}
          detail={detail}
          onHover={onHover}
        />
      </div>
    </div>
  );
}
