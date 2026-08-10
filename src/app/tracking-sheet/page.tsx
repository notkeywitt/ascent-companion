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
  const [periodPinned, setPeriodPinned] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [pinNote, setPinNote] = useState("");

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
        setPeriodPinned(b.periodPinned === true);
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
   * Move the ACTIVE period to whatever month is selected above. This is the only
   * thing that advances it: the hourly sync holds the pinned month until this
   * runs, so a month can't roll over mid-close and wipe CURRENT INVOICE before
   * it has been finalized into its reserved block.
   */
  const advancePeriod = useCallback(async () => {
    if (!ym || pinning) return;
    const { month, year } = parseYm(ym);
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
      const moved = ym !== defaultYm;
      setDefaultYm(ym);
      setPeriodPinned(true);
      setPinNote(
        moved
          ? `Sheets now hold ${ymLabel(month, year)}. The next hourly sync writes that month; ` +
            `Sync now to apply it immediately.`
          : `Pinned to ${ymLabel(month, year)}. The hourly sync will keep it here — it can no ` +
            `longer roll over on its own at month end.`,
      );
    } catch (e) {
      setPinNote(e instanceof Error ? e.message : "Could not change the period.");
    } finally {
      setPinning(false);
    }
  }, [ym, pinning, defaultYm]);

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
        monthLabel: ymLabel(month, year),
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
          {/* ------------------------------------------------ the main action */}
          <Card className="mb-4">
            <Button size="lg" className="w-full py-4 text-base" disabled={!ready} onClick={() => enqueue("sync")}>
              Sync to Tracking Sheet — Current Invoice
            </Button>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ts-month">Billing Month</Label>
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

            {/* Which month the HOURLY sync holds in every sheet's CURRENT
                INVOICE. It used to follow the calendar and roll over on the
                11th — mid-close, before the old month had been finalized. It is
                pinned now, and only the button below moves it. */}
            {defaultYm && (
              <div className="mt-3 rounded-lg border border-line bg-neutral-50 p-3 dark:bg-white/5">
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  Every tracking sheet is held on{" "}
                  <strong className="font-semibold">
                    {(() => {
                      const { month, year } = parseYm(defaultYm);
                      return ymLabel(month, year);
                    })()}
                  </strong>
                  . The hourly sync keeps writing that month until you advance it.
                  {!periodPinned && " (Not pinned yet — still following the calendar.)"}
                </p>

                {/* Shown when the selected month differs from the held one (the
                    normal "advance to next month" case) AND while nothing is
                    pinned yet — otherwise there is no way to pin the month you
                    are already on, which is exactly the first thing anyone needs
                    to do. */}
                {ym && (!periodPinned || ym !== defaultYm) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    disabled={pinning}
                    onClick={advancePeriod}
                  >
                    {(() => {
                      const { month, year } = parseYm(ym);
                      const label = ymLabel(month, year);
                      if (pinning) return ym === defaultYm ? "Pinning…" : "Advancing…";
                      // Same month = there is nothing to advance TO; the action
                      // is simply "stop following the calendar".
                      return ym === defaultYm
                        ? `Pin sheets to ${label}`
                        : `Advance sheets to ${label}`;
                    })()}
                  </Button>
                )}

                {pinNote && (
                  <p className="mt-2 text-xs text-neutral-500">{pinNote}</p>
                )}
              </div>
            )}

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
              block — into the reserved month block and labels it &ldquo;{selectedLabel}&rdquo;.
              Re-running for the same month overwrites that month&apos;s block rather than adding a
              second one. Queued behind any sync already running for the same job.
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
