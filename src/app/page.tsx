"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface Bill {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  status?: string;
  cost?: number;
  issueDate?: string;
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const billTitle = (b: Bill) => b.fromName || b.subject || "Vendor bill";

function CodingQueue() {
  const search = useSearchParams();
  const [jobId, setJobId] = useState(search.get("jobId") ?? "");
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(id: string) {
    if (!id.trim()) return;
    setLoading(true);
    setError("");
    setBills(null);
    try {
      const res = await fetch(`/api/coding-queue?jobId=${encodeURIComponent(id.trim())}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Request failed");
      else setBills(json.bills ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load if a job id arrived in the URL (e.g. coming back from a bill).
  useEffect(() => {
    const fromUrl = search.get("jobId");
    if (fromUrl) run(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = bills?.reduce((s, b) => s + (b.cost ?? 0), 0) ?? 0;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Ascent Companion
          </p>
          {jobId.trim() && (
            <Link
              href={`/unbilled?jobId=${encodeURIComponent(jobId.trim())}`}
              className="text-xs font-semibold text-accent"
            >
              Unbilled →
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Coding Queue</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Draft vendor bills waiting to be coded &amp; approved (read-only for now).
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(jobId);
        }}
        className="mb-6 flex gap-2"
      >
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="JobTread job id, e.g. 22PXGG97EiV4"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? "…" : "Load"}
        </button>
      </form>

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
            {bills.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/bill/${b.id}?jobId=${encodeURIComponent(jobId.trim())}`}
                  className="block rounded-xl border border-neutral-200 bg-white p-3 transition hover:border-accent dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{billTitle(b)}</div>
                      <div className="mt-0.5 truncate text-xs text-neutral-500">
                        {b.subject && b.subject !== billTitle(b) ? b.subject : b.id}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold">{money(b.cost)}</div>
                      <div className="text-xs text-neutral-500">{b.issueDate || ""}</div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
            {bills.length === 0 && (
              <li className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
                No draft bills on this job — nothing to code.
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
