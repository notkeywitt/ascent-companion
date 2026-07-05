"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

interface BudgetItem {
  id: string;
  number: string;
  name: string;
}
interface Line {
  id: string;
  name?: string;
  cost?: number;
  costCode?: { number?: string; name?: string } | null;
  jobCostItem?: { id?: string } | null;
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

function BillDetail() {
  const params = useParams<{ docId: string }>();
  const search = useSearchParams();
  const docId = params.docId;
  const jobId = search.get("jobId") ?? "";

  const [lines, setLines] = useState<Line[] | null>(null);
  const [budget, setBudget] = useState<BudgetItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // local-only coding edits (no writes yet — Phase B)
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/bill?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}`,
        );
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) setError(json.error ?? "Request failed");
        else {
          setLines(json.lines ?? []);
          setBudget(json.budget ?? []);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId, jobId]);

  const total = lines?.reduce((s, l) => s + (l.cost ?? 0), 0) ?? 0;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <Link href="/" className="text-sm font-semibold text-accent">
        ‹ Coding queue
      </Link>

      <header className="mb-4 mt-2">
        <h1 className="text-xl font-bold tracking-tight">Code this bill</h1>
        <p className="mt-1 font-mono text-xs text-neutral-500">{docId}</p>
      </header>

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {lines && (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>
            <span className="font-mono text-sm font-semibold">{money(total)}</span>
          </div>

          <ul className="space-y-2">
            {lines.map((l) => {
              const current = picked[l.id] ?? l.jobCostItem?.id ?? "";
              return (
                <li
                  key={l.id}
                  className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 font-medium">{l.name || "Line item"}</div>
                    <div className="font-mono text-sm font-semibold">{money(l.cost)}</div>
                  </div>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Cost code
                    </span>
                    <select
                      value={current}
                      onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.value }))}
                      className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
                    >
                      <option value="">— uncoded —</option>
                      {budget.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.number} — {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Read-only preview. Saving coding back to JobTread comes next (Phase B) — we&apos;ll
            wire it up after coordinating with the existing AppSheet flow.
          </p>
        </>
      )}
    </main>
  );
}

export default function BillPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <BillDetail />
    </Suspense>
  );
}
