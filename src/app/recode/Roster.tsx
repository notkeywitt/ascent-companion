"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { InvoiceReconcile } from "@/components/InvoiceReconcile";
import { UncapturedBills } from "@/components/UncapturedBills";
import { useAccess } from "@/components/AccessProvider";
import {
  TrackingSheetSync,
  runTrackingSync,
  type TrackingTarget,
  type TrackingSyncState,
} from "@/components/TrackingSheetSync";
import { Breakdown, money, printJob, type Detail } from "@/components/BillingSummary";
import { JtLink } from "@/components/JtLink";
import {
  Banner,
  Button,
  CardSkeletonList,
  EmptyState,
  Label,
  Spinner,
  Toggle,
  btn,
  inputCls,
} from "@/components/ui";

/**
 * The all-jobs month view of Client Invoicing — every client invoice to stage
 * this month, one card per job.
 *
 * This is what the Invoicing page (/stage) was. It lives here because the two
 * halves of the job were split across two routes: this list answered "what does
 * the month owe, across every job", and the workbench answered "where should
 * this bill's cost actually land" — and you cannot finish one without the other.
 * Now they're the same page: no job selected shows the month; picking a job
 * opens the workbench on it.
 *
 * Every figure comes from the SAME endpoints the old page used
 * (/api/stage/jobs for the roster, /api/stage?jobId= for a card's breakdown),
 * so the totals here are the ones JobTread's own invoice builder will produce.
 */

/** One roster row (GET /api/stage/jobs) — the collapsed card, before detail loads. */
interface JobRow {
  jobId: string;
  jobName: string;
  customerName: string;
  billTotal: number;
  billCount: number;
}

/**
 * How many per-job detail fetches run at once during the progressive fill —
 * bounded so we don't hammer the JobTread API (each fetch is a few Pave calls).
 */
const CONCURRENCY = 3;

export function monthOptions() {
  const opts: { ym: string; label: string; lastDay: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    opts.push({
      ym: `${y}-${String(m).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      lastDay: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    });
  }
  return opts;
}

export function Roster({
  ym,
  setYm,
  openJobId,
}: {
  ym: string;
  setYm: (ym: string) => void;
  /** A job whose card should open on arrival — how Back from a bill returns here. */
  openJobId?: string;
}) {
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [detailFailed, setDetailFailed] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState("");
  // Filter toggles (defaults reproduce the original behavior).
  const [uninvoicedOnly, setUninvoicedOnly] = useState(true);
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [groupByCsi, setGroupByCsi] = useState(false);
  const runRef = useRef(0);

  // Which jobs have a tracking sheet, keyed by JobTread job id. This list
  // identifies jobs by JT job id; the tracking-sheet sync is keyed on the
  // internal ProjectID, so this map is the bridge. Loaded once.
  const { can } = useAccess();
  const canTrack = can("tracking-sheet");
  const [trackingTargets, setTrackingTargets] = useState<Map<string, TrackingTarget>>(new Map());
  // Keyed by ProjectID, and owned here so a result outlives its card collapsing.
  const [trackingSync, setTrackingSync] = useState<Record<string, TrackingSyncState>>({});

  const startTrackingSync = useCallback((target: TrackingTarget, month: number, year: number) => {
    const key = target.projectId;
    runTrackingSync(key, month, year, (s) => setTrackingSync((prev) => ({ ...prev, [key]: s })));
  }, []);

  // Every job in this month's roster that has a tracking sheet — what "Sync
  // All" fans out to. Mirrors the per-card gate (`trackingTargets.has(r.jobId)`)
  // so bulk sync never touches a job the page isn't currently showing.
  const trackableTargets = useMemo(
    () =>
      (rows ?? []).map((r) => trackingTargets.get(r.jobId)).filter((t): t is TrackingTarget => !!t),
    [rows, trackingTargets],
  );

  const trackingSummary = useMemo(() => {
    let queued = 0,
      running = 0,
      done = 0,
      error = 0;
    for (const t of trackableTargets) {
      switch (trackingSync[t.projectId]?.status) {
        case "queued":
          queued++;
          break;
        case "running":
          running++;
          break;
        case "done":
          done++;
          break;
        case "error":
          error++;
          break;
      }
    }
    return { queued, running, done, error, total: trackableTargets.length };
  }, [trackableTargets, trackingSync]);

  const syncAllBusy = trackingSummary.queued + trackingSummary.running > 0;

  // Fires the same per-project sync used by each card's own button, once per
  // tracked job — the shared task runner (createTaskRunner(3) inside
  // TrackingSheetSync.tsx) still caps it at 3 concurrent Apps Script round
  // trips, so this is safe to fire all at once.
  const startAllTrackingSync = useCallback(() => {
    const month = Number(ym.split("-")[1]);
    const year = Number(ym.split("-")[0]);
    for (const t of trackableTargets) startTrackingSync(t, month, year);
  }, [trackableTargets, startTrackingSync, ym]);

  // A month change invalidates every result on screen — they describe another
  // billing period.
  useEffect(() => {
    setTrackingSync({});
  }, [ym]);

  useEffect(() => {
    // Gated: /api/tracking-sheet sits behind the "tracking-sheet" view, which a
    // lead does not have even though they can reach Client Invoicing. Asking
    // anyway would just 403.
    if (!canTrack) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
        if (!res.ok) return; // non-fatal — the buttons simply don't appear
        const b = await res.json();
        if (!alive) return;
        const map = new Map<string, TrackingTarget>();
        for (const j of (b.jobs ?? []) as {
          id: string;
          label: string;
          jtJobId: string;
          url: string;
        }[]) {
          if (j.jtJobId) map.set(j.jtJobId, { projectId: j.id, label: j.label, url: j.url });
        }
        setTrackingTargets(map);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      alive = false;
    };
  }, [canTrack]);

  const opt = monthOptions().find((o) => o.ym === ym);
  const monthLabel = opt?.label ?? ym;

  // Fetch one job's full breakdown. `token` ties the result to a load run: a
  // month/toggle change bumps runRef, so a stale (or manually retried) fetch
  // whose token no longer matches drops its result instead of clobbering fresh
  // state. Shared by the progressive fill and the per-card Retry.
  const fetchDetail = useCallback(
    async (r: JobRow, token: number) => {
      setDetailFailed((f) => (f[r.jobId] ? { ...f, [r.jobId]: false } : f));
      try {
        const [y, m] = ym.split("-").map(Number);
        const params = new URLSearchParams({ jobId: r.jobId, year: String(y), month: String(m) });
        if (!uninvoicedOnly) params.set("includeInvoiced", "1");
        if (includeDrafts) params.set("includeDrafts", "1");
        const res = await fetch(`/api/stage?${params.toString()}`);
        const j = await res.json();
        if (token !== runRef.current) return;
        if (res.ok) {
          setDetails((d) => ({
            ...d,
            [r.jobId]: {
              customer: j.customer ?? null,
              job: j.job,
              lines: j.lines ?? [],
              total: j.total ?? 0,
            },
          }));
        } else {
          setDetailFailed((f) => ({ ...f, [r.jobId]: true }));
        }
      } catch {
        if (token === runRef.current) setDetailFailed((f) => ({ ...f, [r.jobId]: true }));
      }
    },
    [ym, uninvoicedOnly, includeDrafts],
  );

  // Progressively fetch every job's breakdown (bounded concurrency). Each card's
  // total is shown only once its detail lands, so the displayed figure is always
  // the authoritative total (bills + uninvoiced time) — never a provisional one.
  const fillDetails = useCallback(
    async (jobRows: JobRow[], token: number) => {
      setFilling(true);
      for (let i = 0; i < jobRows.length; i += CONCURRENCY) {
        if (token !== runRef.current) return;
        await Promise.all(jobRows.slice(i, i + CONCURRENCY).map((r) => fetchDetail(r, token)));
      }
      if (token === runRef.current) setFilling(false);
    },
    [fetchDetail],
  );

  const load = useCallback(async () => {
    const token = ++runRef.current;
    setLoading(true);
    setError("");
    setRows(null);
    setDetails({});
    setDetailFailed({});
    setFilling(false);
    try {
      const [y, m] = ym.split("-").map(Number);
      const params = new URLSearchParams({ year: String(y), month: String(m) });
      if (!uninvoicedOnly) params.set("includeInvoiced", "1");
      if (includeDrafts) params.set("includeDrafts", "1");
      const res = await fetch(`/api/stage/jobs?${params.toString()}`);
      const j = await res.json();
      if (token !== runRef.current) return;
      if (!res.ok) {
        setError(j.error ?? "Failed");
        setRows([]);
        return;
      }
      const jobRows: JobRow[] = j.jobs ?? [];
      setRows(jobRows);
      if (jobRows.length) fillDetails(jobRows, token);
    } catch (e) {
      if (token === runRef.current) setError(e instanceof Error ? e.message : "Network error");
    } finally {
      if (token === runRef.current) setLoading(false);
    }
  }, [ym, uninvoicedOnly, includeDrafts, fillDetails]);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back from a bill (?open=<jobId>) re-opens the card you left from,
  // once it's in the roster, and scrolls to it — the list renders async, so the
  // browser can't do that itself. `didScroll` keeps it to the first arrival, so
  // a later refresh doesn't yank you back up.
  const didScroll = useRef(false);
  useEffect(() => {
    if (!openJobId || !rows?.some((r) => r.jobId === openJobId)) return;
    setOpenId((o) => (o[openJobId] ? o : { ...o, [openJobId]: true }));
    if (didScroll.current) return;
    didScroll.current = true;
    document.getElementById(`job-${openJobId}`)?.scrollIntoView({ block: "center" });
  }, [openJobId, rows]);

  // Grand total = sum of the authoritative per-job totals. Only shown once every
  // card's detail is loaded (while filling, a spinner stands in), so it never
  // displays a partial sum.
  const grandTotal = useMemo(
    () => (rows ?? []).reduce((s, r) => s + (details[r.jobId]?.total ?? 0), 0),
    [rows, details],
  );

  return (
    <>
      {canTrack && trackableTargets.length > 0 && (
        <div className="mb-4 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={syncAllBusy}
            onClick={startAllTrackingSync}
          >
            {syncAllBusy ? (
              <>
                <Spinner className="mr-1.5" />
                Syncing {trackingSummary.done + trackingSummary.error}/{trackingSummary.total}…
              </>
            ) : (
              "Sync All Tracking Sheets"
            )}
          </Button>
        </div>
      )}

      {!syncAllBusy && (trackingSummary.done > 0 || trackingSummary.error > 0) && (
        <p className="-mt-2 mb-4 text-xs text-neutral-500">
          Tracking sheets: {trackingSummary.done} synced
          {trackingSummary.error > 0 && (
            <span className="text-red-600 dark:text-red-400"> · {trackingSummary.error} failed</span>
          )}
          {" — expand a job to see details."}
        </p>
      )}

      {/* Ingested bills that never reached JobTread — real costs missing from the
          invoices below. Deliberately above the month picker and unfiltered by it:
          a stranded bill often carries the wrong billing period, so scoping it to
          the selected month is exactly how it stays hidden. Renders nothing when
          the queue is empty. */}
      <UncapturedBills />

      <div className="mb-3">
        <Label htmlFor="roster-month">Billing month</Label>
        <select
          id="roster-month"
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

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-3">
        <Toggle checked={uninvoicedOnly} onChange={setUninvoicedOnly} label="Uninvoiced only" />
        <Toggle checked={includeDrafts} onChange={setIncludeDrafts} label="Include draft bills" />
        <Toggle checked={groupByCsi} onChange={setGroupByCsi} label="Group by CSI code" />
      </div>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-neutral-500">
            {rows.length} invoice{rows.length === 1 ? "" : "s"} · {monthLabel}
          </span>
          <span className="flex items-center gap-2 font-semibold tabular-nums">
            {filling ? (
              <>
                <Spinner /> Totaling…
              </>
            ) : (
              money(grandTotal)
            )}
          </span>
        </div>
      )}

      {loading && <CardSkeletonList rows={3} />}

      {!loading && rows && rows.length === 0 && !error && (
        <EmptyState>
          No client invoices to stage for {monthLabel} — every finalized bill is already invoiced.
        </EmptyState>
      )}

      <ul className="space-y-2">
        {(rows ?? []).map((r) => {
          const detail = details[r.jobId];
          const failed = !!detailFailed[r.jobId];
          const open = !!openId[r.jobId];
          const customerName = detail?.customer?.name ?? r.customerName;
          const lastDay = opt?.lastDay ?? "";
          return (
            <li
              key={r.jobId}
              id={`job-${r.jobId}`}
              className="scroll-mt-20 rounded-xl border border-line bg-white p-3 dark:bg-ink-raised"
            >
              <button
                type="button"
                onClick={() => setOpenId((o) => ({ ...o, [r.jobId]: !o[r.jobId] }))}
                aria-expanded={open}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  {/* Title = customer, subtitle = job (falls back to job as the
                      title when a card has no customer). */}
                  <div className="truncate font-semibold">
                    {customerName || r.jobName || r.jobId}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
                    <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
                    {customerName && r.jobName && <span className="truncate">{r.jobName}</span>}
                    {customerName && r.jobName && (
                      <span className="text-neutral-300 dark:text-neutral-600">·</span>
                    )}
                    <span className="whitespace-nowrap">
                      {r.billCount} bill{r.billCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {/* Total appears only once the authoritative detail lands, so it
                      always equals the workbench's own figure exactly (never a
                      bills-only placeholder). */}
                  <div className="flex h-7 items-center justify-end text-lg font-bold tabular-nums">
                    {detail ? money(detail.total) : failed ? "—" : <Spinner />}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-400">
                    to invoice
                  </div>
                </div>
              </button>

              {open && (
                <div className="mt-3">
                  {/* Bridge to the actual JobTread customer invoice(s) + a
                      completeness check — shown even while the breakdown loads. */}
                  <div className="mb-3">
                    <InvoiceReconcile jobId={r.jobId} ym={ym} />
                  </div>
                  {/* Push this job's month into its own tracking sheet. Sits above
                      the breakdown so it's usable while that still loads — the
                      sync doesn't depend on it. Absent for jobs with no tracking
                      sheet, and for roles without the Tracking Sheet view. */}
                  {trackingTargets.has(r.jobId) && (
                    <TrackingSheetSync
                      state={trackingSync[trackingTargets.get(r.jobId)!.projectId]}
                      monthLabel={monthLabel}
                      onStart={() =>
                        startTrackingSync(
                          trackingTargets.get(r.jobId)!,
                          Number(ym.split("-")[1]),
                          Number(ym.split("-")[0]),
                        )
                      }
                    />
                  )}
                  {failed ? (
                    <Banner tone="warning" className="!py-2 text-xs">
                      Couldn&apos;t load this job&apos;s breakdown.{" "}
                      <button
                        className="font-semibold underline"
                        onClick={() => fetchDetail(r, runRef.current)}
                      >
                        Retry
                      </button>
                    </Banner>
                  ) : !detail ? (
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <Spinner /> Loading breakdown…
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex justify-end gap-2">
                        {/* The workbench, on this job and this month — recode
                            these bills against live budget headroom. */}
                        <Link
                          href={`/recode?jobId=${encodeURIComponent(r.jobId)}&ym=${ym}`}
                          className={btn("secondary", "sm")}
                        >
                          Code this job →
                        </Link>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => printJob(detail, monthLabel, groupByCsi)}
                        >
                          Print / Save PDF
                        </Button>
                      </div>
                      <Breakdown detail={detail} groupByCsi={groupByCsi} from="invoicing" />
                      <JtLink
                        href={`https://app.jobtread.com/jobs/${r.jobId}/documents`}
                        className={btn("primary", "md", "mt-3 w-full")}
                      >
                        Create invoice in JobTread ↗
                      </JtLink>
                      <p className="mt-2 text-xs text-neutral-500">
                        Open this job in JobTread, then <b>New → Customer Invoice</b> — its builder
                        pulls exactly these uninvoiced bills (and any uninvoiced time). Date it{" "}
                        {lastDay}, review &amp; send.
                      </p>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
