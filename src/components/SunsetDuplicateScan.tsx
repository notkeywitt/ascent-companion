"use client";

import { useState } from "react";

import { JtLink } from "./JtLink";
import { Banner, Button, Spinner } from "./ui";

// Inline "duplicate bill" scanner for the Sunset Statements page. On demand it
// runs the Apps Script Sunset duplicate scan (GET /api/sunset-duplicates → the
// `sunsetDuplicates` action → _sundupScan) and renders the flagged jobs inline,
// each member deep-linking to its JobTread vendorBill. Read-only.

interface Member {
  docId: string;
  jobId: string;
  jobName: string;
  number: number | string;
  externalId: string;
  label: string;
  status: string;
  invoiced: boolean;
  issueDate: string;
  cost: number;
}
interface Finding {
  kind: "amount" | "invoiceNo";
  why?: string;
  amount?: number;
  likelyDuplicates?: number;
  invoiceNo?: string;
  liveCount?: number;
  members: Member[];
}
interface Job {
  jobId: string;
  jobName: string;
  billCount: number;
  findings: Finding[];
}
interface ScanResult {
  ok: boolean;
  cutoff: string;
  scanned: number;
  jobsFlagged: number;
  groupsFlagged: number;
  suspectExcess: number;
  jobs: Job[];
}

const moneyN = (n: number) =>
  Number.isFinite(n)
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const jtDocUrl = (m: Member) =>
  m.docId && m.jobId
    ? `https://app.jobtread.com/jobs/${encodeURIComponent(m.jobId)}/documents/${encodeURIComponent(m.docId)}`
    : "";

const findingHead = (f: Finding) =>
  f.kind === "amount"
    ? `${f.members.length} bills at ${moneyN(f.amount ?? 0)} — ${f.why}`
    : `Invoice #${f.invoiceNo} on ${f.members.length} JobTread docs`;

const statusCls = (s: string) => {
  const v = s.toLowerCase();
  if (v === "denied") return "text-neutral-400 line-through";
  if (v === "draft") return "text-amber-600 dark:text-amber-400";
  if (v === "pending") return "text-sky-600 dark:text-sky-400";
  return "text-emerald-600 dark:text-emerald-400"; // approved
};

export function SunsetDuplicateScan() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [data, setData] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/sunset-duplicates");
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Scan failed");
        setState(data ? "done" : "idle");
        return;
      }
      setData(json as ScanResult);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setState(data ? "done" : "idle");
    }
  }

  const clean = state === "done" && data && data.jobsFlagged === 0;

  return (
    <section className="mb-4 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">Duplicate bill check</div>
          <div className="mt-0.5 text-xs text-neutral-500">
            Flags the same Sunset charge entered into JobTread twice — the usual cause of a statement that reconciles “off by $X.”
          </div>
        </div>
        <Button
          size="sm"
          variant={state === "done" ? "secondary" : "primary"}
          disabled={state === "loading"}
          onClick={run}
        >
          {state === "loading" ? "Scanning…" : state === "done" ? "Rescan" : "Scan"}
        </Button>
      </div>

      {error && (
        <Banner tone="error" className="mt-3 !py-2 text-xs">
          {error}
        </Banner>
      )}

      {state === "loading" && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <Spinner /> Scanning every Sunset bill in JobTread…
        </div>
      )}

      {clean && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
          ✓ No duplicate Sunset bills found — scanned {data!.scanned} bill{data!.scanned === 1 ? "" : "s"} since {data!.cutoff}.
        </div>
      )}

      {state === "done" && data && data.jobsFlagged > 0 && (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
            ⚠ {data.jobsFlagged} job{data.jobsFlagged === 1 ? "" : "s"} · {data.groupsFlagged} duplicate group
            {data.groupsFlagged === 1 ? "" : "s"} · ~{moneyN(data.suspectExcess)} suspected double-counted
          </div>

          {data.jobs.map((job) => (
            <div
              key={job.jobId}
              className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-700/60"
            >
              <div className="text-sm font-semibold">
                {job.jobName}
                <span className="ml-1.5 text-xs font-normal text-neutral-400">
                  {job.billCount} Sunset bill{job.billCount === 1 ? "" : "s"}
                </span>
              </div>

              {job.findings.map((f, fi) => (
                <div key={fi} className="mt-2">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {findingHead(f)}</div>
                  <ul className="mt-1 space-y-0.5">
                    {f.members.map((m, mi) => {
                      const url = jtDocUrl(m);
                      return (
                        <li
                          key={m.docId + "-" + mi}
                          className="flex items-center justify-between gap-3 text-xs tabular-nums"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {url ? (
                              <JtLink
                                href={url}
                                className="font-medium underline decoration-neutral-300 underline-offset-2 hover:decoration-accent hover:text-accent dark:decoration-neutral-600"
                              >
                                {m.label} ↗
                              </JtLink>
                            ) : (
                              <span className="font-medium">{m.label}</span>
                            )}
                            <span className={statusCls(m.status)}>{m.status}</span>
                            {m.invoiced && <span className="text-neutral-400">invoiced</span>}
                            {m.issueDate && <span className="text-neutral-400">· {m.issueDate}</span>}
                          </span>
                          <span>{moneyN(m.cost)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ))}

          <div className="px-0.5 text-[11px] text-neutral-500">
            Legend: <span className="font-medium">#n</span> = from a Sunset email (invoice #) ·{" "}
            <span className="font-medium">JT-n</span> = keyed straight into JobTread. Fix in JobTread: delete or deny the
            redundant bill so one representation of each charge remains.
          </div>
        </div>
      )}
    </section>
  );
}
