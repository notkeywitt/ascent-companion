"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { JobPicker } from "@/components/JobPicker";

interface StageLine {
  key: string;
  label: string;
  cost: number;
  billIds: string[];
  isSunset: boolean;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthOptions() {
  const opts: { year: number; month: number; ym: string; label: string; lastDay: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    opts.push({
      year: y,
      month: m,
      ym: `${y}-${String(m).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      lastDay: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    });
  }
  return opts;
}

function Stage() {
  const search = useSearchParams();
  const router = useRouter();
  const [jobId, setJobId] = useState(search.get("jobId") ?? "");
  const [ym, setYm] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<StageLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);

  const opt = monthOptions().find((o) => o.ym === ym);

  const load = useCallback(async () => {
    const o = monthOptions().find((x) => x.ym === ym);
    if (!jobId || !o) return;
    setLoading(true);
    setError("");
    setMsg("");
    setLines(null);
    try {
      const res = await fetch(`/api/stage?jobId=${encodeURIComponent(jobId)}&year=${o.year}&month=${o.month}`);
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "Failed");
      else {
        setLines(j.lines ?? []);
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

  const billable = (lines ?? []).filter((l) => l.cost > 0);
  const total = billable.reduce((s, l) => s + l.cost, 0);

  async function createInvoice() {
    if (!opt || !customer || billable.length === 0) return;
    setCreating(true);
    setMsg("");
    try {
      const lineItems = billable.map((l) => ({
        name: l.label,
        cost: Math.round(l.cost * 100) / 100,
      }));
      const res = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, accountId: customer.id, issueDate: opt.lastDay, lineItems }),
      });
      const j = await res.json();
      if (!res.ok) setMsg(j.error ?? "Create failed");
      else if (j.previewed)
        setMsg(`Preview only — writes are OFF. Would create ${lineItems.length} lines totalling ${money(total)}.`);
      else setMsg(`Draft invoice created${j.created?.id ? " (" + j.created.id + ")" : ""} — review & send it in JobTread.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Ascent Companion
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Stage Invoice</h1>
        <p className="mt-1 text-sm text-neutral-500">
          A draft customer invoice from a billing month&apos;s bills — Sunset grouped, others itemized.
        </p>
      </header>

      <div className="mb-3 flex gap-2">
        <JobPicker
          value={jobId}
          onChange={(id) => {
            setJobId(id);
            router.replace(`/stage?jobId=${encodeURIComponent(id)}`);
          }}
        />
        <select
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-transparent px-2 text-sm dark:border-neutral-700"
        >
          {monthOptions().map((o) => (
            <option key={o.ym} value={o.ym}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {customer && <p className="mb-3 text-sm text-neutral-500">Customer: {customer.name}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {lines && billable.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No approved bills for this job &amp; month.
        </div>
      )}

      {billable.length > 0 && (
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
                {billable.map((l) => (
                  <tr key={l.key} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2">{l.label}</td>
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

          <button
            onClick={createInvoice}
            disabled={creating || !customer}
            className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {creating ? "Creating…" : `Create draft invoice · ${money(total)}`}
          </button>
          {msg && (
            <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">{msg}</p>
          )}
          <p className="mt-2 text-xs text-neutral-500">
            Dates the invoice {opt?.lastDay}. Creates a <b>draft</b> — you review &amp; send it in JobTread.
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
