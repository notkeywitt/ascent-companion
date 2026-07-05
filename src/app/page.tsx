"use client";

import { useState } from "react";

interface Bill {
  id: string;
  name?: string;
  status?: string;
  cost?: number;
  issueDate?: string;
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

export default function CodingQueue() {
  const [jobId, setJobId] = useState("");
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    if (!jobId.trim()) return;
    setLoading(true);
    setError("");
    setBills(null);
    try {
      const res = await fetch(`/api/coding-queue?jobId=${encodeURIComponent(jobId.trim())}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Request failed");
      else setBills(json.bills ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const total = bills?.reduce((s, b) => s + (b.cost ?? 0), 0) ?? 0;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Ascent Companion
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Coding Queue</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Draft vendor bills waiting to be coded &amp; approved (read-only for now).
        </p>
      </header>

      <form onSubmit={load} className="mb-6 flex gap-2">
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
              <li
                key={b.id}
                className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.name || "Vendor bill"}</div>
                    <div className="mt-0.5 font-mono text-xs text-neutral-500">{b.id}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold">{money(b.cost)}</div>
                    <div className="text-xs text-neutral-500">{b.issueDate || ""}</div>
                  </div>
                </div>
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
