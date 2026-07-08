"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { JtLink } from "@/components/JtLink";

interface Line {
  key: string;
  label: string;
  cost: number;
  billIds: string[];
  isSunset: boolean;
}

import { money } from "@/lib/format";

function monthOptions() {
  const opts: { ym: string; label: string; lastDay: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    opts.push({
      ym: `${y}-${String(m).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      lastDay: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    });
  }
  return opts;
}

function Stage() {
  const search = useSearchParams();
  const jobId = (search.get("jobId") ?? "").trim();
  const [ym, setYm] = useState(() => {
    // Construct the 1st of last month directly — setMonth() on the 29th-31st
    // overflows ("Jun 31" -> Jul 1) and defaults to the CURRENT month.
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const opt = monthOptions().find((o) => o.ym === ym);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    setLines(null);
    try {
      const [y, m] = ym.split("-").map(Number);
      const res = await fetch(
        `/api/stage?jobId=${encodeURIComponent(jobId)}&year=${y}&month=${m}`,
      );
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "Failed");
      else {
        setLines(j.lines ?? []);
        setTotal(j.total ?? 0);
        setCustomer(j.customer ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [jobId, ym]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Ascent Companion
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Stage Invoice</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Uninvoiced bills dated in the selected billing month — Sunset grouped, others itemized.
        </p>
      </header>

      <div className="mb-3">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Invoice date (billing month)
        </label>
        <select
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-2 text-sm dark:border-neutral-700"
        >
          {monthOptions().map((o) => (
            <option key={o.ym} value={o.ym}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!jobId && (
        <p className="mb-3 text-sm text-neutral-500">Pick a job above to stage its invoice.</p>
      )}
      {customer && <p className="mb-3 text-sm text-neutral-500">Customer: {customer.name}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {lines && lines.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No uninvoiced bills — every approved bill on this job is already on a customer invoice.
        </div>
      )}

      {lines && lines.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Bill</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2">
                      {l.billIds.length === 1 ? (
                        <JtLink
                          href={`https://app.jobtread.com/jobs/${jobId}/documents/${l.billIds[0]}`}
                          className="text-accent hover:underline"
                        >
                          {l.label} ↗
                        </JtLink>
                      ) : (
                        l.label
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                  </tr>
                ))}
                <tr className="border-t border-neutral-200 font-semibold dark:border-neutral-700">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{money(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <JtLink
            href={`https://app.jobtread.com/jobs/${jobId}/documents`}
            className="mt-4 block w-full rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Create invoice in JobTread ↗
          </JtLink>
          <p className="mt-2 text-xs text-neutral-500">
            This is what to bill for {opt?.label ?? "the month"}. Tap to open this job in JobTread,
            then <b>New → Customer Invoice</b> — its builder pulls exactly these uninvoiced bills
            (and any uninvoiced time). Date it {opt?.lastDay}, review &amp; send.
          </p>
        </>
      )}
    </main>
  );
}

export default function StagePage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Stage />
    </Suspense>
  );
}
