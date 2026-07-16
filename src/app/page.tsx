"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BillStatusBadge } from "@/components/BillStatusBadge";

interface Bill {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  status?: string;
  cost?: number;
  issueDate?: string;
  jobId?: string; // set only when listing across all jobs
  jobName?: string;
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

// In the Chrome side panel this app runs in an iframe next to a JobTread tab.
// Clicking a queue item asks the extension to open that bill in the main
// JobTread window; the panel itself still navigates to the coding view. No-op on
// mobile / standalone (not framed).
function driveMainWindowToDoc(jobId: string, docId: string) {
  try {
    if (typeof window !== "undefined" && window.top !== window.self && jobId) {
      window.parent.postMessage(
        {
          type: "ascentOpenJtDoc",
          href: `https://app.jobtread.com/jobs/${jobId}/documents/${docId}`,
        },
        "*",
      );
    }
  } catch {
    /* cross-origin / unframed — ignore */
  }
}

const invoiceId = (b: Bill) => b.externalId || b.number || "";
// Sunset keeps "Vendor · Invoice ID" (their invoice # is how the office tells
// same-vendor bills apart); every other vendor shows just its name.
const billTitle = (b: Bill) => {
  const vendor = b.fromName || b.subject || "Vendor bill";
  const inv = invoiceId(b);
  const isSunset = /sunset/i.test(vendor);
  return isSunset && inv ? `${vendor} · ${inv}` : vendor;
};

function CodingQueue() {
  const search = useSearchParams();
  const jobId = (search.get("jobId") ?? "").trim();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // With a job id, that job's drafts; without one, every job's drafts.
  async function run(id: string) {
    setLoading(true);
    setError("");
    setBills(null);
    try {
      const qs = id.trim() ? `?jobId=${encodeURIComponent(id.trim())}` : "";
      const res = await fetch(`/api/coding-queue${qs}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Request failed");
      else setBills(json.bills ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // Load whenever the URL's job changes (global picker writes it there); with no
  // job selected, load every job's drafts.
  useEffect(() => {
    run(jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const total = bills?.reduce((s, b) => s + (b.cost ?? 0), 0) ?? 0;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      {jobId.trim() && (
        <header className="mb-5 flex justify-end gap-3">
          <Link
            href={`/unbilled?jobId=${encodeURIComponent(jobId.trim())}`}
            className="text-xs font-semibold text-accent"
          >
            Unbilled →
          </Link>
          <Link
            href={`/stage?jobId=${encodeURIComponent(jobId.trim())}`}
            className="text-xs font-semibold text-accent"
          >
            Create invoice →
          </Link>
        </header>
      )}

      {!jobId && (
        <p className="mb-3 text-sm text-neutral-500">
          Draft bills across all jobs. Pick a job above to narrow to one.
        </p>
      )}

      {loading && <p className="mb-3 text-sm text-neutral-500">Loading…</p>}

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {bills && (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {bills.length} draft {bills.length === 1 ? "bill" : "bills"}
            </span>
            <span className="font-mono text-sm font-semibold">{money(total)}</span>
          </div>
          <ul className="space-y-2">
            {bills.map((b) => {
              // A bill's own job — set when listing across all jobs; otherwise the
              // selected job. Needed so the bill view loads the right budget/CTC.
              const billJobId = (b.jobId || jobId).trim();
              return (
                <li key={b.id}>
                  <Link
                    href={`/bill/${b.id}?jobId=${encodeURIComponent(billJobId)}`}
                    onClick={() => driveMainWindowToDoc(billJobId, b.id)}
                    className="block rounded-xl border border-neutral-200 bg-white p-3 transition hover:border-accent dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium">{billTitle(b)}</div>
                          <BillStatusBadge status={b.status} />
                        </div>
                        <div className="mt-0.5 truncate text-xs text-neutral-500">
                          {!jobId && b.jobName
                            ? b.jobName
                            : b.subject && b.subject !== billTitle(b)
                              ? b.subject
                              : b.id}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold">{money(b.cost)}</div>
                        <div className="text-xs text-neutral-500">{b.issueDate || ""}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
            {bills.length === 0 && (
              <li className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
                {jobId
                  ? "No draft bills on this job — nothing to code."
                  : "No draft bills anywhere — nothing to code."}
              </li>
            )}
          </ul>
        </>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <CodingQueue />
    </Suspense>
  );
}
