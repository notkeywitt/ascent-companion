"use client";

import { useEffect, useMemo, useState } from "react";

import { toast } from "@/components/Toast";
import { Banner, Loading, inputCls } from "@/components/ui";

interface Job {
  id: string;
  name: string;
  phase: string | null;
}
interface Code {
  number: string;
  name: string;
}
type Rates = Record<string, number>; // "jobId|code" → $/h

/** One job: each Labor cost code in its budget beside a dollar rate. */
function JobCard({ job, rates, onSaved }: { job: Job; rates: Rates; onSaved: (code: string, rate: number | null) => void }) {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/labor-rates/map?jobId=${encodeURIComponent(job.id)}`)
      .then((r) => r.json())
      .then((b) => (b.error ? setErr(b.error) : setCodes(b.codes as Code[])))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, [job.id]);

  async function save(code: string, text: string) {
    const clean = text.replace(/[^0-9.]/g, "");
    const rate = clean === "" ? null : Number(clean);
    if (rate === (rates[`${job.id}|${code}`] ?? null)) return;
    const r = await fetch("/api/labor-rates/map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, costCode: code, hourlyRate: rate }),
    });
    const b = await r.json();
    if (b.error) toast(b.error, { tone: "error" });
    else onSaved(code, rate);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white dark:bg-ink-raised">
      <div className="border-b border-line-soft bg-neutral-50 px-3 py-2 text-sm font-semibold dark:border-neutral-800/70 dark:bg-white/5">
        {job.name}
      </div>
      {err ? (
        <p className="px-3 py-2 text-xs text-danger">{err}</p>
      ) : !codes ? (
        <p className="px-3 py-2 text-xs text-neutral-500">Reading the budget…</p>
      ) : codes.length === 0 ? (
        <p className="px-3 py-2 text-xs text-neutral-500">No Labor cost codes in the budget.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {codes.map((c) => (
            <li key={c.number} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="tabular-nums">{c.number}</span> <span className="text-neutral-500">{c.name}</span>
              </span>
              <div className="relative w-24 shrink-0">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                <input
                  aria-label={`${job.name} ${c.number} rate`}
                  defaultValue={rates[`${job.id}|${c.number}`] ?? ""}
                  inputMode="decimal"
                  onBlur={(e) => void save(c.number, e.target.value)}
                  className={inputCls + " pl-5 text-right"}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Labor Rates Map: a card per job, grouped by Phase. */
export function LaborRatesMap() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [rates, setRates] = useState<Rates>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/jobs?withPhase=1").then((r) => r.json()),
      fetch("/api/labor-rates/map", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([j, m]) => {
        if (j.error || m.error) return setErr(j.error || m.error);
        setJobs(j.jobs as Job[]);
        setRates(Object.fromEntries((m.rates as { jobId: string; costCode: string; hourlyRate: number }[]).map((r) => [`${r.jobId}|${r.costCode}`, r.hourlyRate])));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const phases = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of [...(jobs ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      const p = j.phase || "No phase";
      m.set(p, [...(m.get(p) ?? []), j]);
    }
    return [...m].sort(([a], [b]) => (a === "No phase" ? 1 : b === "No phase" ? -1 : a.localeCompare(b)));
  }, [jobs]);

  return (
    <section className="mb-8 w-full">
      <h2 className="mb-1 text-base font-bold">Labor Rates Map</h2>
      <p className="mb-3 text-xs text-neutral-500">
        What each job pays per hour for each Labor cost code. Labor › Check pay rates assigns these to time entries.
      </p>
      {err && <Banner tone="error">{err}</Banner>}
      {!jobs && !err && <Loading label="Loading jobs…" />}
      {phases.map(([phase, list]) => (
        <div key={phase} className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{phase}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                rates={rates}
                onSaved={(code, rate) =>
                  setRates((r) => {
                    const { [`${j.id}|${code}`]: _, ...rest } = r;
                    return rate === null ? rest : { ...rest, [`${j.id}|${code}`]: rate };
                  })
                }
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
