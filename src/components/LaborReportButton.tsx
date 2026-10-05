"use client";

import { useState } from "react";
import { Button, Card, Select } from "@/components/ui";
import { deriveBillingPeriod, ymOf } from "@/lib/billing";
import { billingMonths } from "@/lib/billingMonths";
import { useAccess } from "@/components/AccessProvider";

/**
 * "Create Labor Report in Drive" — the month's COMPANY-WIDE labor, filed as one
 * Google Sheet in the Drive Labor folder.
 *
 * Rendered where a month of hours is read: Labor Review's "Time entries"
 * header, the Tracking Sheets all-jobs view, and a job workbench's closing
 * actions (Board.tsx), so a labor fix made on a job reaches the sheet without
 * leaving the page — and, with a month picker of its own, on Labor Import
 * (`LaborReportCard` below). It is
 * one component for the same reason `TimeEntryList` is — the two were going to
 * be hand-written twins otherwise, and the outcome message is the part that
 * would have drifted.
 *
 * NOT SCOPED TO THE JOB ON SCREEN. It takes only the month. Every job's time
 * entries go in, because that is what payroll reads, and the page's job
 * selection has nothing to do with it. That is worth saying at each call site,
 * because both hosts are otherwise entirely about one job.
 *
 * One file per month, overwritten in place (`POST /api/labor-report` → Apps
 * Script `writeLaborReport`), so pressing it twice does not make two files and
 * the URL keeps working.
 *
 * Writes nothing to JobTread — the sheet mirrors what JobTread already holds,
 * so staged, unsynced recodes are deliberately absent from it.
 */
export function LaborReportButton({
  ym,
  className = "",
  size = "sm",
  disabled = false,
  buttonClassName = "",
}: {
  /** The billing month to report, "YYYY-MM". */
  ym: string;
  className?: string;
  size?: "sm" | "md";
  /** The host has staged edits JobTread does not hold yet. The report reads
   *  JobTread, so running it now would file the month without them. */
  disabled?: boolean;
  buttonClassName?: string;
}) {
  const canReport = useAccess().can("labor-review");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string; url?: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/labor-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym }),
      });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setMsg({
        tone: "ok",
        text: `${j.created ? "Created" : "Updated"} “${j.title}” — ${j.entries} time ${
          j.entries === 1 ? "entry" : "entries"
        } across ${j.jobs} ${j.jobs === 1 ? "job" : "jobs"}.`,
        url: typeof j.url === "string" ? j.url : undefined,
      });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Report failed" });
    } finally {
      setBusy(false);
    }
  };

  // /api/labor-report rides the "labor-review" gate, so a person without it
  // would only get a 403. This covers both hosts, Tracking Sheets included.
  if (!canReport) return null;

  return (
    <div className={`flex min-w-0 flex-col items-start gap-1 ${className}`}>
      <Button
        variant="secondary"
        size={size}
        onClick={run}
        disabled={busy || !ym || disabled}
        className={buttonClassName}
        title={
          disabled
            ? "Save staged changes to JobTread first — the report reads JobTread"
            : "File the whole COMPANY's labor for this month as a Google Sheet in the Drive Labor folder — every job, not just this one, and not the on-screen filters. One file per month, overwritten each time."
        }
      >
        {busy ? "Writing…" : "Create Labor Report in Drive"}
      </Button>
      {msg && (
        <p
          role={msg.tone === "error" ? "alert" : "status"}
          className={`text-[11.5px] ${
            msg.tone === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {msg.text}
          {msg.url && (
            <>
              {" "}
              <a href={msg.url} target="_blank" rel="noreferrer" className="text-accent underline">
                Open the sheet
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The same button with its own month, for a page that has none — Labor Import,
 * in the People workspace (NAVIGATION_PLAN.md stage 3). Defaults to the billing
 * month by the 10th-of-the-month rule every bill is filed by.
 */
export function LaborReportCard() {
  const canReport = useAccess().can("labor-review");
  const [ym, setYm] = useState(() => ymOf(deriveBillingPeriod(new Date(), false)));
  if (!canReport) return null;
  return (
    <Card className="mb-5 space-y-2">
      <div className="text-sm font-semibold">Monthly Labor Report</div>
      <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
        Every job&apos;s hours for the month, from JobTread, filed as one sheet in the Drive Labor folder.
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <Select aria-label="Month" value={ym} onChange={(e) => setYm(e.target.value)} className="w-48">
          {billingMonths(15).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <LaborReportButton ym={ym} size="md" />
      </div>
    </Card>
  );
}
