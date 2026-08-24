"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Label,
  Loading,
  PageHeader,
  SectionLabel,
  Select,
  Spinner,
  btn,
} from "@/components/ui";
import { createTaskRunner } from "@/lib/taskRunner";
import { TrackingSheetRisks } from "@/components/TrackingSheetRisks";

/**
 * Google Tracking Sheet — pushes a job's month of sub/vendor invoices into that
 * project's own tracking spreadsheet, replacing the by-hand copy out of the
 * Expenditure Summary.
 *
 * Two actions, both handled by Apps Script (TrackingSheets.js) because only it
 * holds the Sheets grants:
 *   Sync     → the month's CSI | Amount | Vendor rows land at A1 of the sheet's
 *              "SubVendor Invoices" tab, feeding its CURRENT INVOICE column.
 *   Finalize → the CURRENT INVOICE block is copied into the month's reserved
 *              historical block and labelled (e.g. "July '26").
 *
 * Both run in the BACKGROUND: tapping either queues the work and frees the
 * controls immediately, so the office can walk down the job list without waiting
 * out each round trip. Two rules keep that safe:
 *
 *   - Work for one job is SERIALIZED (a per-job promise chain). Finalize reads
 *     the CURRENT INVOICE column, which a Sync for the same job is in the middle
 *     of changing, so those must never overlap.
 *   - Work for different jobs runs in PARALLEL, capped at MAX_PARALLEL so a long
 *     queue doesn't open a dozen simultaneous Apps Script executions.
 *
 * Only projects with a "Tracking Sheet" URL on their Projects row appear here.
 */

/** Simultaneous in-flight requests across DIFFERENT jobs. */
const MAX_PARALLEL = 3;

interface JobRef {
  id: string;
  label: string;
  jtJobId: string;
  url: string;
}

/**
 * The automatic all-projects sync's state, from Apps Script's _tsSyncStatus().
 * `paused` is a Script Property, not a trigger change: the trigger keeps firing
 * and the run short-circuits, so resuming is instant and needs no reinstall.
 */
interface SyncStatus {
  paused: boolean;
  /** ISO stamp of when the pause was set. Empty while running. */
  pausedAt: string;
  /** Optional reason recorded with the pause. */
  note: string;
  /** False means nothing is scheduled at all — pausing would be moot. */
  triggerInstalled: boolean;
  intervalMinutes: number;
  lastRun: {
    at: string;
    jobCount: number;
    succeeded: number;
    failed: number;
    totalSynced: number;
    elapsedMs: number;
  } | null;
}

/** A tracking sheet wired to more than one project — sync is blocked until fixed. */
interface SharedSheet {
  fileId: string;
  projects: { projectId: string; label: string; row: number }[];
}

interface UnmatchedCsi {
  csi: string;
  amount: number;
  vendors: string[];
}

interface SyncResult {
  ok: true;
  rowCount: number;
  billCount: number;
  total: number;
  unmatched: UnmatchedCsi[];
  /** Header cell holds different whitespace (a non-breaking space) — retype it. */
  whitespaceOnly?: UnmatchedCsi[];
  /** Column exists but has no FILTER/total formulas, so it reads $0 forever. */
  deadColumns?: (UnmatchedCsi & { column?: string; missing?: string[] })[];
  unmatchedTotal: number;
  trackingSheetName: string;
  trackingSheetUrl: string;
  tab: string;
  durationSec?: number;
  jtPages?: number;
  costItemsScanned?: number;
  timings?: Record<string, number>;
}

interface FinalizeResult {
  ok: true;
  monthLabel: string;
  mode: string;
  blockIndex: number;
  blockCount: number;
  blocksRemaining: number;
  targetRange: string;
  dataRowCount: number;
  totalsRows: string;
  totalRow: number;
  sheetTotalRow: Record<string, number>;
  trackingSheetUrl: string;
}

type Op = "sync" | "finalize";
type JobStatus = "queued" | "running" | "done" | "error";

interface QueueItem {
  key: number;
  op: Op;
  projectId: string;
  jobLabel: string;
  monthLabel: string;
  month: number;
  year: number;
  status: JobStatus;
  error?: string;
  sync?: SyncResult;
  finalize?: FinalizeResult;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "12 minutes ago" — the only thing anyone wants to know about the last run. */
function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs === 1) return "1 hour ago";
  if (hrs < 48) return `${hrs} hours ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

const money = (n: number) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-07" for the <Select> value, so month and year travel as one field. */
const ymKey = (month: number, year: number) => `${year}-${String(month).padStart(2, "0")}`;
const parseYm = (s: string) => {
  const [y, m] = s.split("-");
  return { month: parseInt(m, 10), year: parseInt(y, 10) };
};
const ymLabel = (month: number, year: number) =>
  `${MONTH_NAMES[month - 1]} '${String(year).slice(-2)}`;

/**
 * The label the finalized block carries. Tracking sheets label a month block
 * with the month it was INVOICED to the client, which is the month AFTER its
 * billing period — June billing goes out on the July invoice, so that block
 * reads "July '26". Everything else on this page speaks billing period.
 */
const invoiceLabel = (month: number, year: number) =>
  month === 12 ? ymLabel(1, year + 1) : ymLabel(month + 1, year);

/** The 24 billing periods ending at the current one — newest first. */
function monthOptions(month: number, year: number) {
  const out: { key: string; label: string }[] = [];
  let m = month;
  let y = year;
  for (let i = 0; i < 24; i++) {
    out.push({ key: ymKey(m, y), label: ymLabel(m, y) });
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return out;
}

export default function TrackingSheetPage() {
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [shared, setShared] = useState<SharedSheet[]>([]);
  const [projectId, setProjectId] = useState("");
  const [ym, setYm] = useState("");
  // The ACTIVE period — the month every wired sheet's CURRENT INVOICE block is
  // held on by the hourly sync. It only moves when someone advances it below.
  const [defaultYm, setDefaultYm] = useState("");
  // What the Automatic-sync card's month <Select> is showing. Starts on the
  // held month; pinning it is a separate, explicit tap.
  const [pinnedYm, setPinnedYm] = useState("");
  const [periodPinned, setPeriodPinned] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [pinNote, setPinNote] = useState("");

  // The automatic sync itself — paused or running, and how the last run went.
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState("");

  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // Serializes work per ProjectID, parallel across jobs, capped. A ref, not
  // state: it drives scheduling, not paint.
  const runner = useRef(createTaskRunner(MAX_PARALLEL));
  const nextKey = useRef(1);

  // ---------------------------------------------------------------- bootstrap
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
        const b = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
        const list: JobRef[] = b.jobs || [];
        setJobs(list);
        setShared(b.shared || []);
        if (list.length === 1) setProjectId(list[0].id);
        const key = ymKey(Number(b.defaultMonth), Number(b.defaultYear));
        setDefaultYm(key);
        setYm(key);
        setPinnedYm(key);
        setPeriodPinned(b.periodPinned === true);
        setSync((b.sync as SyncStatus) || null);
      } catch (e) {
        if (alive) setBootError(e instanceof Error ? e.message : "Could not load projects.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const job = useMemo(() => jobs.find((j) => j.id === projectId) || null, [jobs, projectId]);
  const months = useMemo(() => {
    if (!defaultYm) return [];
    const { month, year } = parseYm(defaultYm);
    return monthOptions(month, year);
  }, [defaultYm]);

  /**
   * Pin the ACTIVE period to the month chosen in the Automatic-sync card. This
   * is the only thing that moves it: the sync holds the pinned month until this
   * runs, so a month can't roll over mid-close and wipe CURRENT INVOICE before
   * it has been finalized into its reserved block.
   */
  const advancePeriod = useCallback(async () => {
    if (!pinnedYm || pinning) return;
    const { month, year } = parseYm(pinnedYm);
    setPinning(true);
    setPinNote("");
    try {
      const res = await fetch("/api/tracking-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "setPeriod", month, year }),
      });
      const b = await res.json();
      if (!res.ok || b?.ok === false) {
        throw new Error(b?.error || `Request failed (${res.status})`);
      }
      const moved = pinnedYm !== defaultYm;
      setDefaultYm(pinnedYm);
      setPeriodPinned(true);
      // The manual month follows the held month unless it was deliberately
      // pointed somewhere else, so the common case needs one tap, not two.
      setYm((cur) => (cur === "" || cur === defaultYm ? pinnedYm : cur));
      setPinNote(
        moved
          ? `Sheets now hold ${ymLabel(month, year)}. The next automatic run writes that ` +
            `month to every SubVendor Invoices tab; Sync below to apply it to one job now.`
          : `Pinned to ${ymLabel(month, year)}. The sync will keep it here — it can no ` +
            `longer roll over on its own at month end.`,
      );
    } catch (e) {
      setPinNote(e instanceof Error ? e.message : "Could not change the period.");
    } finally {
      setPinning(false);
    }
  }, [pinnedYm, pinning, defaultYm]);

  /**
   * Pause or resume the automatic all-projects sync.
   *
   * Pausing is what you do before touching a tracking sheet by hand: the
   * scheduled run rewrites every wired sheet's SubVendor Invoices tab from
   * JobTread, and would otherwise land on top of the reconciliation in
   * progress. Apps Script leaves the trigger installed and short-circuits on a
   * flag, so resuming takes effect on the very next run.
   */
  const togglePause = useCallback(
    async (next: boolean) => {
      if (pausing) return;
      setPausing(true);
      setPauseError("");
      try {
        const res = await fetch("/api/tracking-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "setPaused",
            paused: next,
            note: next ? "Paused from the Assistant." : "",
          }),
        });
        const b = await res.json();
        if (!res.ok || b?.ok === false) {
          throw new Error(b?.error || `Request failed (${res.status})`);
        }
        // Apps Script echoes the status back, so the switch reflects what the
        // server actually holds rather than what we optimistically assumed.
        if (b.sync) setSync(b.sync as SyncStatus);
        else setSync((cur) => (cur ? { ...cur, paused: next } : cur));
      } catch (e) {
        setPauseError(e instanceof Error ? e.message : "Could not change the sync.");
      } finally {
        setPausing(false);
      }
    },
    [pausing],
  );

  const patch = useCallback((key: number, fields: Partial<QueueItem>) => {
    setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...fields } : it)));
  }, []);

  const enqueue = useCallback(
    (op: Op) => {
      if (!projectId || !ym) return;
      const { month, year } = parseYm(ym);
      const target = jobs.find((j) => j.id === projectId);
      if (!target) return;

      const key = nextKey.current++;
      const item: QueueItem = {
        key,
        op,
        projectId,
        jobLabel: target.label,
        // A finalize is named for the block it lands in (the invoicing month);
        // a sync is named for the billing period it pulls.
        monthLabel: op === "finalize" ? invoiceLabel(month, year) : ymLabel(month, year),
        month,
        year,
        status: "queued",
      };
      setQueue((q) => [item, ...q]);

      // Keyed on the ProjectID so a Finalize can never read the CURRENT INVOICE
      // column while a Sync for the same job is still rewriting it. Other jobs
      // proceed in parallel.
      void runner.current.run(projectId, async () => {
        patch(key, { status: "running" });
        try {
          const res = await fetch("/api/tracking-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ op, projectId, month, year }),
          });
          const b = await res.json();
          if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
          patch(key, {
            status: "done",
            ...(op === "sync" ? { sync: b as SyncResult } : { finalize: b as FinalizeResult }),
          });
        } catch (e) {
          patch(key, { status: "error", error: e instanceof Error ? e.message : "Something went wrong." });
        }
      });
    },
    [projectId, ym, jobs, patch],
  );

  const selectedLabel = ym
    ? (() => { const { month, year } = parseYm(ym); return ymLabel(month, year); })()
    : "";
  const selectedInvoiceLabel = ym
    ? (() => { const { month, year } = parseYm(ym); return invoiceLabel(month, year); })()
    : "";
  const busy = queue.filter((it) => it.status === "queued" || it.status === "running").length;
  const ready = !!projectId && !!ym;

  if (loading)
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <Loading label="Loading tracking sheets…" />
      </main>
    );

  return (
    // The app's standard page container. This was a bare <div> with no padding
    // at all, so the title and every card sat hard against both screen edges on
    // a phone — the only page besides Historical Cost Import that wasn't on it.
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Tracking Sheet"
        description="Push a job's month of sub/vendor invoices into its Google tracking sheet, then finalize the month."
      />

      {bootError && <Banner tone="error" className="mb-4">{bootError}</Banner>}

      {shared.length > 0 && (
        <Banner tone="error" className="mb-4">
          <p className="font-semibold">
            {shared.length === 1 ? "A tracking sheet is" : `${shared.length} tracking sheets are`}{" "}
            wired to more than one job — syncing those jobs is blocked.
          </p>
          <p className="mt-1">
            One job would overwrite the other&apos;s numbers. Clear the wrong job&apos;s{" "}
            <span className="font-semibold">Tracking Sheet</span> cell on the Projects sheet, then
            reload.
          </p>
          {shared.map((s) => (
            <ul key={s.fileId} className="mt-2 list-inside list-disc">
              {s.projects.map((p) => (
                <li key={p.projectId}>
                  {p.label} <span className="opacity-70">({p.projectId}, Projects row {p.row})</span>
                </li>
              ))}
            </ul>
          ))}
        </Banner>
      )}

      {!bootError && jobs.length === 0 && (
        <EmptyState>
          No project has a tracking sheet yet. Add its URL to the{" "}
          <span className="font-semibold">Tracking Sheet</span> column of the Projects sheet.
        </EmptyState>
      )}

      {jobs.length > 0 && (
        <>
          {/* --------------------------------------------- the automatic sync */}
          {/* The two org-wide controls, together because they govern the same
              thing: the scheduled run that rewrites EVERY wired sheet's
              SubVendor Invoices tab. Pause it before reconciling a month by
              hand; pin the month so it can't roll over on its own mid-close. */}
          <Card className="mb-4">
            <SectionLabel className="mb-2">Automatic sync</SectionLabel>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                    !sync?.triggerInstalled
                      ? "bg-neutral-400"
                      : sync.paused
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                />
                <div className="text-sm">
                  <p className="font-semibold">
                    {!sync
                      ? "Unknown"
                      : !sync.triggerInstalled
                        ? "Not scheduled"
                        : sync.paused
                          ? "Paused"
                          : "Running"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {!sync ? (
                      "Could not read the sync's state."
                    ) : !sync.triggerInstalled ? (
                      <>Nothing is scheduled — run <span className="font-mono">installAllTrackingSheetsSyncTrigger()</span> in Apps Script.</>
                    ) : sync.paused ? (
                      <>
                        No sheet has been rewritten
                        {sync.pausedAt ? ` since ${timeAgo(sync.pausedAt)}` : ""}.
                      </>
                    ) : (
                      <>Every sheet is rewritten every {sync.intervalMinutes} minutes.</>
                    )}
                  </p>
                </div>
              </div>

              {sync && (
                <Button
                  variant={sync.paused ? "primary" : "danger"}
                  size="sm"
                  disabled={pausing}
                  onClick={() => togglePause(!sync.paused)}
                >
                  {pausing
                    ? sync.paused
                      ? "Resuming…"
                      : "Pausing…"
                    : sync.paused
                      ? "Resume sync"
                      : "Pause sync"}
                </Button>
              )}
            </div>

            {pauseError && (
              <Banner tone="error" className="mt-3">{pauseError}</Banner>
            )}

            {sync?.paused && (
              <Banner tone="warning" className="mt-3">
                Paused — the sheets are frozen where they are, so you can reconcile a month
                without a scheduled run landing on top of it. The Sync and Finalize buttons
                below still work: those are one job at a time, and you asked for them.
              </Banner>
            )}

            {sync?.lastRun && (
              <p className="mt-3 text-xs text-neutral-500">
                Last automatic run {timeAgo(sync.lastRun.at)} — {sync.lastRun.succeeded}/
                {sync.lastRun.jobCount} job{sync.lastRun.jobCount === 1 ? "" : "s"},{" "}
                {money(sync.lastRun.totalSynced)}
                {sync.lastRun.failed > 0 ? `, ${sync.lastRun.failed} failed` : ""}.
              </p>
            )}

            {/* ------------------------------ which month the sheets are held on */}
            <div className="mt-4 border-t border-line pt-4">
              <Label htmlFor="ts-pinned-month">Billing month written to every SubVendor Invoices tab</Label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Select
                  id="ts-pinned-month"
                  className="min-w-40 flex-1"
                  value={pinnedYm}
                  onChange={(e) => setPinnedYm(e.target.value)}
                >
                  {months.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                      {m.key === defaultYm ? " (sheets are on this)" : ""}
                    </option>
                  ))}
                </Select>

                {/* Hidden only when the month is already pinned AND selected —
                    the one case with nothing to do. It must stay available when
                    nothing is pinned yet, which is exactly the first thing
                    anyone needs to do. */}
                {pinnedYm && (!periodPinned || pinnedYm !== defaultYm) && (
                  <Button variant="secondary" size="md" disabled={pinning} onClick={advancePeriod}>
                    {(() => {
                      const { month, year } = parseYm(pinnedYm);
                      const label = ymLabel(month, year);
                      if (pinning) return pinnedYm === defaultYm ? "Pinning…" : "Advancing…";
                      // Same month = there is nothing to advance TO; the action
                      // is simply "stop following the calendar".
                      return pinnedYm === defaultYm ? `Pin to ${label}` : `Advance to ${label}`;
                    })()}
                  </Button>
                )}
              </div>

              <p className="mt-2 text-xs text-neutral-500">
                {defaultYm && (
                  <>
                    Sheets are held on{" "}
                    <strong className="font-semibold">
                      {(() => {
                        const { month, year } = parseYm(defaultYm);
                        return ymLabel(month, year);
                      })()}
                    </strong>
                    {". "}
                  </>
                )}
                The sync keeps writing that month&apos;s sub/vendor invoices until you advance
                it — it never rolls over on its own, so a month can&apos;t vanish out of CURRENT
                INVOICE before it has been finalized.
                {!periodPinned && " Not pinned yet — still following the calendar."}
              </p>

              {pinNote && <p className="mt-2 text-xs text-neutral-500">{pinNote}</p>}
            </div>
          </Card>

          {/* ------------------------------------------------ the main action */}
          <Card className="mb-4">
            <SectionLabel className="mb-2">Sync one job now</SectionLabel>
            <Button size="lg" className="w-full py-4 text-base" disabled={!ready} onClick={() => enqueue("sync")}>
              Sync to Tracking Sheet — Current Invoice
            </Button>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ts-month">Billing month (this job)</Label>
                <Select id="ts-month" value={ym} onChange={(e) => setYm(e.target.value)}>
                  {months.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                      {m.key === defaultYm ? " (sheets are on this)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ts-job">Job</Label>
                <Select id="ts-job" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Choose a job…</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            <p className="mt-3 text-xs text-neutral-500">
              {job ? (
                <>
                  Writes {selectedLabel} to{" "}
                  <a href={job.url} target="_blank" rel="noreferrer" className="underline hover:text-accent">
                    this job&apos;s tracking sheet
                  </a>
                  . Runs in the background — pick the next job right away.
                </>
              ) : (
                "Runs in the background — queue as many jobs as you like without waiting."
              )}
            </p>
          </Card>

          {/* -------------------------------------------------------- finalize */}
          <Card className="mb-4">
            <SectionLabel className="mb-1">Finalize {selectedLabel}</SectionLabel>
            <p className="mb-3 text-xs text-neutral-500">
              Copies the Tracking Sheet&apos;s CURRENT INVOICE column — cost codes and the totals
              block — into the reserved month block and labels it &ldquo;{selectedInvoiceLabel}
              &rdquo;: a block is named for the month it is invoiced to the client, the month after
              its billing period. Re-running for the same month overwrites that block rather than
              adding a second one. Queued behind any sync already running for the same job.
            </p>
            <Button variant="outline" size="lg" className="w-full" disabled={!ready} onClick={() => enqueue("finalize")}>
              Finalize {selectedLabel}
            </Button>
          </Card>

          {/* ----------------------------------------------------------- queue */}
          {queue.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <SectionLabel>
                  Activity{busy > 0 ? ` — ${busy} in progress` : ""}
                </SectionLabel>
                {busy === 0 && (
                  <button
                    type="button"
                    onClick={() => setQueue([])}
                    className="text-xs text-neutral-500 underline hover:text-accent"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {queue.map((it) => (
                  <QueueRow key={it.key} item={it} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ queue row */

function QueueRow({ item }: { item: QueueItem }) {
  const pending = item.status === "queued" || item.status === "running";
  const s = item.sync;
  const f = item.finalize;

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.jobLabel}</p>
          <p className="text-xs text-neutral-500">
            {item.op === "sync" ? "Sync" : "Finalize"} · {item.monthLabel}
          </p>
        </div>
        <div className="shrink-0 text-xs">
          {item.status === "queued" && <span className="text-neutral-500">Queued</span>}
          {item.status === "running" && (
            <span className="inline-flex items-center gap-1.5 text-neutral-500">
              <Spinner /> Working
            </span>
          )}
          {item.status === "done" && <span className="font-semibold text-emerald-600">Done</span>}
          {item.status === "error" && <span className="font-semibold text-red-600">Failed</span>}
        </div>
      </div>

      {item.status === "error" && (
        <Banner tone="error" className="mt-2 text-xs">{item.error}</Banner>
      )}

      {!pending && s && (
        <>
          <p className="mt-2 text-sm">
            <span className="font-semibold">{s.rowCount}</span> row{s.rowCount === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold">{money(s.total)}</span> · {s.billCount} bill
            {s.billCount === 1 ? "" : "s"}
            {typeof s.durationSec === "number" && (
              <span className="text-neutral-500"> · {s.durationSec.toFixed(1)}s</span>
            )}
          </p>
          {s.timings && (
            <p className="mt-0.5 text-[11px] text-neutral-500">
              JobTread {(s.timings.jtPullMs / 1000).toFixed(1)}s
              {typeof s.jtPages === "number" ? ` (${s.jtPages}pg/${s.costItemsScanned}ci)` : ""} · open{" "}
              {(s.timings.openSheetMs / 1000).toFixed(1)}s · write {(s.timings.writeMs / 1000).toFixed(1)}s
              {typeof s.timings.auditLogMs === "number"
                ? ` · log ${(s.timings.auditLogMs / 1000).toFixed(1)}s`
                : ""}
            </p>
          )}
          <TrackingSheetRisks
            unmatched={s.unmatched}
            whitespaceOnly={s.whitespaceOnly}
            deadColumns={s.deadColumns}
            className="mt-2"
          />
          <a
            href={s.trackingSheetUrl}
            target="_blank"
            rel="noreferrer"
            className={btn("secondary", "sm", "mt-2")}
          >
            Open {s.trackingSheetName}
          </a>
        </>
      )}

      {!pending && f && (
        <>
          <p className="mt-2 text-sm">
            {f.mode === "overwrote-existing-month-block"
              ? `Replaced the existing ${f.monthLabel} block`
              : `Filed ${f.monthLabel} into a new block`}{" "}
            at <span className="font-mono text-xs">{f.targetRange}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            Block {f.blockIndex} of {f.blockCount}, {f.blocksRemaining} left · {f.dataRowCount}{" "}
            cost-code rows
            {f.totalsRows !== "none" ? ` + totals rows ${f.totalsRows}` : ""}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            {Object.entries(f.sheetTotalRow).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{k}</dt>
                <dd className="font-semibold">{money(v)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}
