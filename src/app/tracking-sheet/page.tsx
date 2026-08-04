"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
 * Only projects with a "Tracking Sheet" URL on their Projects row appear here.
 */

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
  dryRun: boolean;
  jobLabel: string;
  monthLabel: string;
  trackingSheetName: string;
  trackingSheetUrl: string;
  tab: string;
  rowCount: number;
  billCount: number;
  total: number;
  unmatched: UnmatchedCsi[];
  unmatchedTotal: number;
  note: string;
}

interface FinalizeResult {
  ok: true;
  dryRun: boolean;
  jobLabel: string;
  monthLabel: string;
  trackingSheetName: string;
  trackingSheetUrl: string;
  tab: string;
  mode: string;
  previousLabel: string;
  blockIndex: number;
  blockCount: number;
  blocksRemaining: number;
  targetRange: string;
  labelCell: string;
  rowCount: number;
  columns: string[];
  totals: Record<string, number>;
  overwroteValues: boolean;
  note: string;
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
  const [defaultYm, setDefaultYm] = useState("");

  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState("");
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [finalized, setFinalized] = useState<FinalizeResult | null>(null);

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

  const ready = !!projectId && !!ym && !syncing && !finalizing;

  // Changing the job or month invalidates whatever's on screen — those results
  // describe a different push.
  const resetResults = useCallback(() => {
    setSync(null);
    setFinalized(null);
    setError("");
  }, []);

  const run = useCallback(
    async (op: "sync" | "finalize") => {
      if (!projectId || !ym) return;
      const { month, year } = parseYm(ym);
      setError("");
      if (op === "sync") { setSyncing(true); setSync(null); setFinalized(null); }
      else { setFinalizing(true); setFinalized(null); }
      try {
        const res = await fetch("/api/tracking-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, projectId, month, year }),
        });
        const b = await res.json();
        if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
        if (op === "sync") setSync(b as SyncResult);
        else setFinalized(b as FinalizeResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setSyncing(false);
        setFinalizing(false);
      }
    },
    [projectId, ym],
  );

  const selectedLabel = ym ? (() => { const { month, year } = parseYm(ym); return ymLabel(month, year); })() : "";

  if (loading) return <Loading label="Loading tracking sheets…" />;

  return (
    <div className="mx-auto max-w-2xl">
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
            <Button
              size="lg"
              className="w-full py-4 text-base"
              disabled={!ready}
              onClick={() => run("sync")}
            >
              {syncing ? (
                <>
                  <Spinner className="mr-2" /> Syncing…
                </>
              ) : (
                "Sync to Tracking Sheet — Current Invoice"
              )}
            </Button>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ts-month">Billing Month</Label>
                <Select
                  id="ts-month"
                  value={ym}
                  disabled={syncing || finalizing}
                  onChange={(e) => { setYm(e.target.value); resetResults(); }}
                >
                  {months.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                      {m.key === defaultYm ? " (current)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ts-job">Job</Label>
                <Select
                  id="ts-job"
                  value={projectId}
                  disabled={syncing || finalizing}
                  onChange={(e) => { setProjectId(e.target.value); resetResults(); }}
                >
                  <option value="">Choose a job…</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            {job && (
              <p className="mt-3 text-xs text-neutral-500">
                Writes {selectedLabel} to{" "}
                <a href={job.url} target="_blank" rel="noreferrer" className="underline hover:text-accent">
                  this job&apos;s tracking sheet
                </a>{" "}
                → SubVendor Invoices!A1.
              </p>
            )}
          </Card>

          {error && <Banner tone="error" className="mb-4">{error}</Banner>}

          {/* ----------------------------------------------------- sync result */}
          {sync && (
            <Card className="mb-4">
              <Banner tone={sync.unmatched.length ? "warning" : "success"}>
                Wrote <span className="font-semibold">{sync.rowCount}</span> row
                {sync.rowCount === 1 ? "" : "s"} totalling{" "}
                <span className="font-semibold">{money(sync.total)}</span> from {sync.billCount} bill
                {sync.billCount === 1 ? "" : "s"} to {sync.tab}.
              </Banner>

              {sync.unmatched.length > 0 && (
                <div className="mt-3">
                  <SectionLabel className="mb-1">
                    Not in the sheet&apos;s CSI header row — {money(sync.unmatchedTotal)} at risk
                  </SectionLabel>
                  <p className="mb-2 text-xs text-neutral-500">
                    These rows were written, but the sheet&apos;s pivot has no column for them, so
                    they will not reach the Tracking Sheet&apos;s INVOICES total. Add the codes to
                    row 1 of the SubVendor Invoices tab (or run{" "}
                    <code className="text-[11px]">repairTrackingSheetLookups</code>), then sync again.
                  </p>
                  <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-700/60">
                    {sync.unmatched.map((u) => (
                      <li key={u.csi} className="flex items-baseline justify-between gap-3 py-1.5">
                        <span className="font-mono text-xs">{u.csi}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
                          {u.vendors.join(", ")}
                        </span>
                        <span className="font-semibold">{money(u.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={sync.trackingSheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={btn("secondary", "sm")}
                >
                  Open {sync.trackingSheetName}
                </a>
              </div>
            </Card>
          )}

          {/* -------------------------------------------------------- finalize */}
          <Card>
            <SectionLabel className="mb-1">Finalize {selectedLabel}</SectionLabel>
            <p className="mb-3 text-xs text-neutral-500">
              Copies the Tracking Sheet&apos;s CURRENT INVOICE block into the reserved month block
              and labels it &ldquo;{selectedLabel}&rdquo;. Re-running for the same month overwrites
              that month&apos;s block rather than adding a second one. Sync first so CURRENT INVOICE
              holds this month&apos;s numbers.
            </p>
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              disabled={!ready}
              onClick={() => run("finalize")}
            >
              {finalizing ? (
                <>
                  <Spinner className="mr-2" /> Finalizing…
                </>
              ) : (
                `Finalize ${selectedLabel}`
              )}
            </Button>

            {finalized && (
              <div className="mt-3">
                <Banner tone="success">
                  {finalized.mode === "overwrote-existing-month-block"
                    ? `Replaced the existing ${finalized.monthLabel} block`
                    : `Filed ${finalized.monthLabel} into a new block`}{" "}
                  at <span className="font-mono text-xs">{finalized.targetRange}</span> (block{" "}
                  {finalized.blockIndex} of {finalized.blockCount}, {finalized.blocksRemaining} left).
                </Banner>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  {Object.entries(finalized.totals).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        {k}
                      </dt>
                      <dd className="font-semibold">{money(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
