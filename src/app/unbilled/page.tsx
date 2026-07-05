"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface RollupRow {
  type: string;
  status: string;
  cost: number;
  priceWithTax: number;
  count: number;
}
interface Summary {
  billedCost: number;
  invoicedCost: number;
  draftInvoiceCost: number;
  draftBillCost: number;
  unbilled: number;
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

function Unbilled() {
  const search = useSearchParams();
  const [jobId, setJobId] = useState(search.get("jobId") ?? "");
  const [rollup, setRollup] = useState<RollupRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(id: string) {
    if (!id.trim()) return;
    setLoading(true);
    setError("");
    setRollup(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/unbilled?jobId=${encodeURIComponent(id.trim())}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Request failed");
      else {
        setRollup(json.rollup ?? []);
        setSummary(json.summary ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const fromUrl = search.get("jobId");
    if (fromUrl) run(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Ascent Companion
          </p>
          {jobId.trim() && (
            <Link
              href={`/?jobId=${encodeURIComponent(jobId.trim())}`}
              className="text-xs font-semibold text-accent"
            >
              ← Coding queue
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Unbilled Expenses</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Approved bill cost not yet on an approved customer invoice.
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
          placeholder="JobTread job id"
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

      {summary && (
        <div className="mb-5 rounded-2xl border border-accent/30 bg-accent/5 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            Unbilled (at cost)
          </div>
          <div className="mt-1 font-mono text-3xl font-bold">{money(summary.unbilled)}</div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
            <span>Approved bill cost</span>
            <span className="text-right font-mono">{money(summary.billedCost)}</span>
            <span>Invoiced (approved)</span>
            <span className="text-right font-mono">{money(summary.invoicedCost)}</span>
            <span>Draft invoice (staged)</span>
            <span className="text-right font-mono">{money(summary.draftInvoiceCost)}</span>
            <span>Draft bills (to code)</span>
            <span className="text-right font-mono">{money(summary.draftBillCost)}</span>
          </div>
        </div>
      )}

      {rollup && rollup.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2 font-medium">Document</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">#</th>
              </tr>
            </thead>
            <tbody>
              {rollup.map((r, i) => (
                <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.type}</span>{" "}
                    <span className="text-neutral-500">/ {r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{money(r.cost)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.priceWithTax ? money(r.priceWithTax) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-neutral-500">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function UnbilledPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Unbilled />
    </Suspense>
  );
}
