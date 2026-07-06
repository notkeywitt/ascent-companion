"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Line {
  code: string;
  name: string;
  billed: number;
  invoiced: number;
  remainder: number;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [total, setTotal] = useState(0);
  const [netTotal, setNetTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);

  const opt = monthOptions().find((o) => o.ym === ym);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    setMsg("");
    setLines(null);
    try {
      const res = await fetch(`/api/stage?jobId=${encodeURIComponent(jobId)}`);
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "Failed");
      else {
        setLines(j.lines ?? []);
        setTotal(j.total ?? 0);
        setNetTotal(j.netTotal ?? 0);
        setCustomer(j.customer ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createInvoice() {
    if (!opt) return;
    setCreating(true);
    setMsg("");
    try {
      const res = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, issueDate: opt.lastDay }),
      });
      const j = await res.json();
      if (!res.ok) setMsg(j.error ?? "Create failed");
      else if (j.previewed) setMsg(j.message ?? "Preview only — writes are OFF.");
      else
        setMsg(
          `Draft invoice created${j.created?.id ? " (" + j.created.id + ")" : ""} — JobTread pulled the uninvoiced cost; review & send it there.`,
        );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setCreating(false);
    }
  }

  const recodeGap = Math.abs(netTotal - total) > 0.5;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Ascent Companion
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Stage Invoice</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Uninvoiced cost per code — exactly what a new draft invoice will pull. Fully-invoiced
          codes drop off automatically.
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
          Nothing uninvoiced — every approved cost on this job is already on a customer invoice.
        </div>
      )}

      {lines && lines.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Cost code</th>
                  <th className="px-3 py-2 text-right font-medium">Uninvoiced</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.code} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-neutral-500">{l.code}</span>{" "}
                      {l.name}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{money(l.remainder)}</td>
                  </tr>
                ))}
                <tr className="border-t border-neutral-200 font-semibold dark:border-neutral-700">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{money(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {recodeGap && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Heads up: the job&apos;s net uninvoiced is {money(netTotal)}, which differs from the
              {" "}
              {money(total)} above. That gap means some cost was invoiced under a different code than
              it was billed to. JobTread will reconcile on its side — treat this as a rough check.
            </p>
          )}

          <button
            onClick={createInvoice}
            disabled={creating}
            className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create draft invoice"}
          </button>
          {msg && (
            <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">{msg}</p>
          )}
          <p className="mt-2 text-xs text-neutral-500">
            The table is a sanity check. Creating a <b>draft</b> invoice dated {opt?.lastDay} lets
            JobTread pull the uninvoiced cost itself — you review &amp; send it there.
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
