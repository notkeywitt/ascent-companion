"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Input,
  Label,
  Loading,
  PageHeader,
  SectionLabel,
  Select,
  Spinner,
  Toggle,
  btn,
} from "@/components/ui";
import { JobPicker, type JobRef } from "@/components/JobPicker";

/**
 * Admin utility: capture a job's historical costs — everything its Google
 * Tracking Sheet already shows as invoiced, through a chosen cutoff — as ONE
 * draft vendor bill in JobTread, coded per CSI cost code. For jobs whose spend
 * history predates (or was never fully entered into) JobTread.
 *
 * Paste any tracking sheet URL and pick the JobTread job it belongs to — this
 * does NOT require the job to already have its "Tracking Sheet" column wired
 * up on the Projects sheet (unlike /tracking-sheet), since the whole point is
 * often to bring an older job into the system for the first time.
 *
 * Preview computes, per CSI code: tracking-sheet total minus whatever's
 * ALREADY a real vendor bill in JobTread over the same range — never a blind
 * total, so nothing gets double-counted. Only the gap becomes a bill line.
 * Re-running for the same job reconciles the ONE historical bill it manages
 * (replaces it, or deletes it once real bills fully catch up) rather than
 * creating a second one.
 */

interface JobsBrowserJob {
  id: string;
  name: string;
  number?: string;
  customer?: string;
  address?: string;
}

interface GapRow {
  csi: string;
  sheetTotal: number;
  alreadyInJt: number;
  gap: number;
}

interface GapReport {
  ok: true;
  jtJobId: string;
  jobLabel: string;
  trackingSheetName: string;
  trackingSheetUrl: string;
  tab: string;
  startLabel: string;
  endLabel: string;
  blocksUsed: string[];
  includedCurrentInvoice: boolean;
  rows: GapRow[];
  sheetTotalSum: number;
  alreadyInJtSum: number;
  gapSum: number;
  existingDocId: string | null;
  existingStatus: string | null;
}

interface UpsertResult {
  ok: true;
  mode: "create" | "replace" | "delete" | "no-op";
  docId?: string;
  replacedDocId?: string | null;
  deletedDocId?: string;
  lineCount?: number;
  total?: number;
  unmappedCount?: number;
  note: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const money = (n: number) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthOptions(count: number) {
  const out: { key: string; month: number; year: number; label: string }[] = [];
  const now = new Date();
  let m = now.getMonth() + 1;
  let y = now.getFullYear();
  for (let i = 0; i < count; i++) {
    out.push({ key: `${y}-${String(m).padStart(2, "0")}`, month: m, year: y, label: `${MONTH_NAMES[m - 1]} ${y}` });
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return out;
}

export default function HistoricalCostPage() {
  const [jobs, setJobs] = useState<JobsBrowserJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState("");

  const [url, setUrl] = useState("");
  const [jtJobId, setJtJobId] = useState("");
  const [hasStart, setHasStart] = useState(false);
  const months = useMemo(() => monthOptions(36), []);
  const [startKey, setStartKey] = useState(months[months.length - 1]?.key ?? "");
  const [endKey, setEndKey] = useState(months[0]?.key ?? "");

  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [gap, setGap] = useState<GapReport | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [result, setResult] = useState<UpsertResult | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/jobs/browser", { cache: "no-store" });
        const b = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
        setJobs(b.jobs ?? []);
      } catch (e) {
        if (alive) setJobsError(e instanceof Error ? e.message : "Could not load jobs.");
      } finally {
        if (alive) setJobsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const findKey = useCallback((key: string) => months.find((m) => m.key === key), [months]);

  const ready = !!url.trim() && !!jtJobId && !!endKey && (!hasStart || !!startKey);

  const resetDownstream = useCallback(() => {
    setGap(null);
    setPreviewError("");
    setResult(null);
    setCommitError("");
    setConfirming(false);
  }, []);

  const runPreview = useCallback(async () => {
    if (!ready) return;
    setPreviewing(true);
    setPreviewError("");
    setGap(null);
    setResult(null);
    setConfirming(false);
    try {
      const end = findKey(endKey)!;
      const start = hasStart ? findKey(startKey) : null;
      const res = await fetch("/api/historical-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "preview",
          url,
          jtJobId,
          endMonth: end.month,
          endYear: end.year,
          startMonth: start ? start.month : null,
          startYear: start ? start.year : null,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
      setGap(b as GapReport);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPreviewing(false);
    }
  }, [ready, url, jtJobId, endKey, startKey, hasStart, findKey]);

  const runCommit = useCallback(async () => {
    if (!gap) return;
    setCommitting(true);
    setCommitError("");
    try {
      const end = findKey(endKey)!;
      const start = hasStart ? findKey(startKey) : null;
      const res = await fetch("/api/historical-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "create",
          url,
          jtJobId,
          endMonth: end.month,
          endYear: end.year,
          startMonth: start ? start.month : null,
          startYear: start ? start.year : null,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
      setResult(b as UpsertResult);
      setConfirming(false);
      // Re-preview so the screen reflects the new state (existing doc, gap now 0, etc).
      void runPreview();
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setCommitting(false);
    }
  }, [gap, url, jtJobId, endKey, startKey, hasStart, findKey, runPreview]);

  const selectedJob = jobs.find((j) => j.id === jtJobId) || null;
  const commitLabel = gap
    ? gap.existingDocId
      ? gap.rows.length === 0 || gap.gapSum === 0
        ? "Delete Historical Bill"
        : "Replace Historical Bill"
      : "Create Draft Bill"
    : "";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Historical Cost Import"
        description="Capture a job's historical costs from its Tracking Sheet as one draft JobTread bill, coded by cost code."
      />
      <Banner tone="info" className="mb-4 text-xs">
        Admin utility. Compares the Tracking Sheet&apos;s totals against real vendor bills already in
        JobTread and only bills the difference — nothing gets double-counted. Re-running for the same
        job updates the one historical bill it manages instead of creating another.
      </Banner>

      <Card className="mb-4">
        <Label htmlFor="hc-url">Tracking Sheet URL</Label>
        <Input
          id="hc-url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); resetDownstream(); }}
          placeholder="https://docs.google.com/spreadsheets/d/…"
        />

        <div className="mt-3">
          <Label htmlFor="hc-job">Job</Label>
          {jobsError && <Banner tone="error" className="mb-2 text-xs">{jobsError}</Banner>}
          <JobPicker
            value={jtJobId}
            onChange={(id) => { setJtJobId(id); resetDownstream(); }}
            jobs={jobsLoading ? undefined : jobs}
            includeAll={false}
            placeholder="Choose a job…"
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor="hc-start" className="!mb-0">Start (optional)</Label>
              <Toggle
                checked={hasStart}
                onChange={(v) => { setHasStart(v); resetDownstream(); }}
                label=""
              />
            </div>
            <Select
              id="hc-start"
              value={startKey}
              disabled={!hasStart}
              onChange={(e) => { setStartKey(e.target.value); resetDownstream(); }}
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="hc-end">Through</Label>
            <Select
              id="hc-end"
              value={endKey}
              onChange={(e) => { setEndKey(e.target.value); resetDownstream(); }}
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </Select>
          </div>
        </div>

        <Button className="mt-3 w-full" disabled={!ready || previewing} onClick={runPreview}>
          {previewing ? (<><Spinner className="mr-2" /> Comparing to JobTread…</>) : "Preview Gap"}
        </Button>

        {jobsLoading && <Loading label="Loading jobs…" />}
      </Card>

      {previewError && <Banner tone="error" className="mb-4">{previewError}</Banner>}

      {gap && (
        <Card className="mb-4">
          <SectionLabel className="mb-1">
            {gap.jobLabel} — {gap.startLabel} through {gap.endLabel}
          </SectionLabel>
          <p className="mb-3 text-xs text-neutral-500">
            {gap.trackingSheetName} / {gap.tab}
            {gap.blocksUsed.length > 0 && <> · blocks used: {gap.blocksUsed.join(", ")}</>}
            {gap.includedCurrentInvoice && <> · includes the live CURRENT INVOICE</>}
          </p>

          {gap.existingDocId && (
            <Banner tone={gap.existingStatus === "draft" ? "warning" : "error"} className="mb-3 text-xs">
              {gap.existingStatus === "draft"
                ? `A draft historical bill already exists for this job (JT doc ${gap.existingDocId}) — committing will replace it with the numbers below.`
                : `A historical bill exists (JT doc ${gap.existingDocId}) but its status is "${gap.existingStatus}" — a human has already approved or is using it. This tool will refuse to touch it.`}
            </Banner>
          )}

          <div className="grid grid-cols-3 gap-3 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-white/5">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Tracking Sheet</div>
              <div className="font-semibold">{money(gap.sheetTotalSum)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Already in JobTread</div>
              <div className="font-semibold">{money(gap.alreadyInJtSum)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Gap (to bill)</div>
              <div className="font-semibold">{money(gap.gapSum)}</div>
            </div>
          </div>

          {gap.rows.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">No cost codes in range.</p>
          ) : (
            <div className="mt-3 max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="pb-1">CSI</th>
                    <th className="pb-1 text-right">Sheet</th>
                    <th className="pb-1 text-right">In JT</th>
                    <th className="pb-1 text-right">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700/60">
                  {gap.rows.map((r) => (
                    <tr key={r.csi} className={r.gap === 0 ? "opacity-50" : ""}>
                      <td className="py-1 font-mono text-xs">{r.csi}</td>
                      <td className="py-1 text-right">{money(r.sheetTotal)}</td>
                      <td className="py-1 text-right">{money(r.alreadyInJt)}</td>
                      <td className="py-1 text-right font-semibold">{money(r.gap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4">
            {!confirming ? (
              <Button
                variant={gap.existingStatus && gap.existingStatus !== "draft" ? "secondary" : "primary"}
                className="w-full"
                disabled={!!(gap.existingStatus && gap.existingStatus !== "draft")}
                onClick={() => setConfirming(true)}
              >
                {commitLabel}
              </Button>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20">
                <p className="mb-2 text-sm font-semibold">
                  {gap.existingDocId
                    ? `This will DELETE the existing draft bill (${gap.existingDocId}) and create a new one with the numbers above — confirm?`
                    : "This will create a real draft bill in JobTread — confirm?"}
                </p>
                <div className="flex gap-2">
                  <Button variant="danger" disabled={committing} onClick={runCommit}>
                    {committing ? (<><Spinner className="mr-2" /> Working…</>) : "Yes, commit to JobTread"}
                  </Button>
                  <Button variant="secondary" disabled={committing} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {commitError && <Banner tone="error" className="mt-3 text-xs">{commitError}</Banner>}
        </Card>
      )}

      {result && (
        <Card>
          <Banner tone="success" className="text-sm">{result.note}</Banner>
          {result.docId && (
            <a
              href={`https://app.jobtread.com/jobs/${jtJobId}/documents/${result.docId}`}
              target="_blank"
              rel="noreferrer"
              className={btn("secondary", "sm", "mt-3")}
            >
              Open in JobTread ↗
            </a>
          )}
        </Card>
      )}
    </div>
  );
}
