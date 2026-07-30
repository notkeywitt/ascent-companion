"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import { Banner, CardSkeletonList, EmptyState, PageHeader } from "@/components/ui";

interface Bill {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  status?: string;
  cost?: number; // pre-tax line subtotal
  nonRecoverableTax?: number; // recorded sales tax (document-level, "Tax")
  issueDate?: string;
  jobId?: string; // set only when listing across all jobs
  jobName?: string;
  saved?: boolean; // Save has been clicked on this bill in the Assistant
  reviewed?: boolean; // bill explicitly marked reviewed in the Assistant
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

// A bill's amount owed is JobTread's document `cost` = the sum of the line costs, which
// IS JobTread's bill total. The fixed sales tax (`nonRecoverableTax`) is carved OUT of
// that total for the subtotal, never added on top (confirmed live 2026-07-30). Matches
// the bill page's total exactly.
const billAmount = (b: Bill) => b.cost ?? 0;

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
  // Coding is a review queue, so reviewed bills are done — hide them by default,
  // with a toggle to bring them back into view.
  const [hideReviewed, setHideReviewed] = useState(true);

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

  const reviewedCount = bills?.filter((b) => b.reviewed).length ?? 0;
  // What the list actually renders — reviewed bills drop out unless shown.
  const visible = bills ? (hideReviewed ? bills.filter((b) => !b.reviewed) : bills) : null;
  const total = visible?.reduce((s, b) => s + billAmount(b), 0) ?? 0;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Coding Review"
        description={
          jobId.trim()
            ? "Draft bills on this job, waiting to be coded."
            : "Draft bills across all jobs. Pick a job above to narrow to one."
        }
        actions={
          jobId.trim() ? (
            <>
              <Link
                href={`/unbilled?jobId=${encodeURIComponent(jobId.trim())}`}
                className="text-xs font-semibold text-accent dark:text-accent-soft"
              >
                Unbilled →
              </Link>
              <Link
                href={`/stage?jobId=${encodeURIComponent(jobId.trim())}`}
                className="text-xs font-semibold text-accent dark:text-accent-soft"
              >
                Create invoice →
              </Link>
            </>
          ) : undefined
        }
      />

      {loading && <CardSkeletonList rows={4} />}

      {error && <Banner tone="error">{error}</Banner>}

      {bills && visible && (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-medium">
                  {visible.length} draft {visible.length === 1 ? "bill" : "bills"}
                </span>
                {hideReviewed && reviewedCount > 0 && (
                  <span className="text-xs text-neutral-400">
                    · {reviewedCount} reviewed hidden
                  </span>
                )}
              </div>
              {reviewedCount > 0 && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={!hideReviewed}
                  onClick={() => setHideReviewed((v) => !v)}
                  className="inline-flex items-center gap-2 text-xs font-medium text-neutral-500 transition hover:text-accent dark:hover:text-accent-soft"
                >
                  <span
                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                      hideReviewed ? "bg-neutral-300 dark:bg-neutral-600" : "bg-accent"
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition ${
                        hideReviewed ? "translate-x-0.5" : "translate-x-3.5"
                      }`}
                    />
                  </span>
                  Show reviewed
                </button>
              )}
            </div>
            <span className="font-mono text-sm font-semibold">{money(total)}</span>
          </div>
          <ul className="space-y-2">
            {visible.map((b) => {
              // A bill's own job — set when listing across all jobs; otherwise the
              // selected job. Needed so the bill view loads the right budget/CTC.
              const billJobId = (b.jobId || jobId).trim();
              return (
                <li key={b.id}>
                  <Link
                    href={`/bill/${b.id}?jobId=${encodeURIComponent(billJobId)}`}
                    onClick={() => driveMainWindowToDoc(billJobId, b.id)}
                    className="block rounded-xl border border-neutral-200 bg-white p-3 transition hover:border-accent hover:shadow-sm dark:border-neutral-700/60 dark:bg-ink-raised"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium">{billTitle(b)}</div>
                          <BillStatusBadge status={b.status} />
                          {b.reviewed ? (
                            <span
                              title="Marked reviewed in the Assistant"
                              className="inline-block shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                            >
                              ✓ Reviewed
                            </span>
                          ) : b.saved ? (
                            <span
                              title="Save has been clicked on this bill"
                              className="inline-block shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              ✓ Saved
                            </span>
                          ) : null}
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
                        <div className="font-mono text-sm font-semibold">{money(billAmount(b))}</div>
                        <div className="text-xs text-neutral-500">{b.issueDate || ""}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li>
                <EmptyState>
                  {bills.length > 0
                    ? "Every draft bill here is marked reviewed. Turn on “Show reviewed” to see them."
                    : jobId
                      ? "No draft bills on this job — nothing to code."
                      : "No draft bills anywhere — nothing to code."}
                </EmptyState>
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
