"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banner, Loading, tableCls } from "@/components/ui";
import { monthLabel } from "@/lib/billingMonths";
import type { DepositSummary } from "@/lib/deposits";
import { money } from "@/lib/money";

/**
 * Every job with a deposit: deposit, applied to date, left. Opened from the
 * deposit card. Read-only; `/api/deposits/all`, rules `summarizeDeposit`.
 */
export function AllDeposits({ currentJobId }: { currentJobId?: string }) {
  const [jobs, setJobs] = useState<DepositSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/deposits/all")
      .then(async (res) => {
        const j = await res.json();
        if (!live) return;
        if (res.ok) setJobs(j.jobs);
        else setError(j.error ?? "Failed");
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Network error"));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <Banner tone="warning" className="text-xs">Couldn&apos;t read the deposits: {error}</Banner>;
  if (!jobs) return <Loading label="Reading every job's deposit…" />;
  if (!jobs.length) return <p className="text-xs text-neutral-500 dark:text-neutral-400">No job has a deposit.</p>;

  const total = (k: "deposit" | "applied" | "onDraft") => jobs.reduce((s, j) => s + j[k], 0);
  const totalLeft = jobs.reduce((s, j) => s + (j.left ?? 0), 0);

  return (
    <div className="overflow-x-auto">
      <table className={`${tableCls.root} min-w-[36rem]`}>
        <thead>
          <tr>
            <th className={tableCls.th}>Job</th>
            <th className={tableCls.thNum}>Deposit</th>
            <th className={tableCls.thNum}>Applied to date</th>
            <th className={tableCls.thNum}>On a draft</th>
            <th className={tableCls.thNum}>Left</th>
            <th className={tableCls.th}>Last draw</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.jobId} className={tableCls.tr}>
              <td className={tableCls.td}>
                <Link
                  href={`/trackingsheet?jobId=${encodeURIComponent(j.jobId)}`}
                  className={`hover:underline ${j.jobId === currentJobId ? "font-semibold" : ""}`}
                >
                  {j.jobName || j.jobId}
                </Link>
                {j.flags.length > 0 && (
                  <span className="ml-2 text-xs text-danger">
                    {j.flags.map((f) => (f.kind === "overdrawn" ? `overdrawn ${money(f.by)}` : "taxable line")).join(", ")}
                  </span>
                )}
                {j.source == null && <span className="ml-2 text-xs text-warn">no deposit recorded</span>}
              </td>
              <td className={tableCls.tdNum}>{j.source ? money(j.deposit) : "—"}</td>
              <td className={tableCls.tdNum}>{money(j.applied)}</td>
              <td className={tableCls.tdNum}>{j.onDraft ? money(j.onDraft) : ""}</td>
              <td className={`${tableCls.tdNum} font-semibold`}>{j.left == null ? "—" : money(j.left)}</td>
              <td className={tableCls.td}>{j.lastDrawYm ? monthLabel(j.lastDrawYm) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={tableCls.foot}>
            <td className={tableCls.td}>{jobs.length} jobs</td>
            <td className={tableCls.tdNum}>{money(total("deposit"))}</td>
            <td className={tableCls.tdNum}>{money(total("applied"))}</td>
            <td className={tableCls.tdNum}>{total("onDraft") ? money(total("onDraft")) : ""}</td>
            <td className={tableCls.tdNum}>{money(totalLeft)}</td>
            <td className={tableCls.td} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
