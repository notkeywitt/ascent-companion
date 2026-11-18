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
  division: string;
}
type Rates = Record<string, number>; // "jobId|code" → $/h

const parseRate = (text: string) => {
  const clean = text.replace(/[^0-9.]/g, "");
  return clean === "" ? null : Number(clean);
};

function RateInput({ label, value, placeholder, onCommit }: { label: string; value: number | "" ; placeholder?: string; onCommit: (text: string) => void }) {
  return (
    <div className="relative w-24 shrink-0">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
      <input
        key={String(value)}
        aria-label={label}
        defaultValue={value}
        placeholder={placeholder}
        inputMode="decimal"
        onBlur={(e) => onCommit(e.target.value)}
        className={inputCls + " pl-5 text-right"}
      />
    </div>
  );
}

/** One job: its Labor cost codes grouped by division. A division sets every code's rate at once; expand it to edit single rows. */
function JobCard({ job, rates, onSaved }: { job: Job; rates: Rates; onSaved: (codes: string[], rate: number | null) => void }) {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set()); // groups start collapsed

  useEffect(() => {
    fetch(`/api/labor-rates/map?jobId=${encodeURIComponent(job.id)}`)
      .then((r) => r.json())
      .then((b) => (b.error ? setErr(b.error) : setCodes(b.codes as Code[])))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, [job.id]);

  const divisions = useMemo(() => {
    const m = new Map<string, Code[]>();
    for (const c of codes ?? []) m.set(c.division, [...(m.get(c.division) ?? []), c]);
    return [...m].sort(([a], [b]) => (a === "No division" ? 1 : b === "No division" ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  }, [codes]);

  async function save(list: Code[], text: string) {
    const rate = parseRate(text);
    const changed = list.filter((c) => (rates[`${job.id}|${c.number}`] ?? null) !== rate);
    if (changed.length === 0) return;
    const r = await fetch("/api/labor-rates/map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, costCodes: changed.map((c) => c.number), hourlyRate: rate }),
    });
    const b = await r.json();
    if (b.error) toast(b.error, { tone: "error" });
    else onSaved(changed.map((c) => c.number), rate);
  }

  const toggle = (d: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(d)) n.add(d);
      return n;
    });

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
        <div className="divide-y divide-line-soft">
          {divisions.map(([division, list]) => {
            const vals = list.map((c) => rates[`${job.id}|${c.number}`] ?? "");
            const same = vals.every((v) => v === vals[0]);
            const isOpen = open.has(division);
            return (
              <div key={division}>
                <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(division)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left font-medium"
                  >
                    <span className={"shrink-0 text-neutral-400 transition-transform " + (isOpen ? "rotate-90" : "")}>›</span>
                    <span className="min-w-0 flex-1 truncate">{division}</span>
                    <span className="shrink-0 text-xs font-normal text-neutral-500">{list.length}</span>
                  </button>
                  <RateInput
                    label={`${job.name} ${division} rate for all`}
                    value={same ? vals[0] : ""}
                    placeholder={same ? "" : "mixed"}
                    onCommit={(t) => void save(list, t)}
                  />
                </div>
                {isOpen && (
                  <ul className="divide-y divide-line-soft bg-neutral-50/60 dark:bg-white/[0.03]">
                    {list.map((c) => (
                      <li key={c.number} className="flex items-center gap-2 py-1.5 pl-8 pr-3 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="tabular-nums">{c.number}</span> <span className="text-neutral-500">{c.name}</span>
                        </span>
                        <RateInput
                          label={`${job.name} ${c.number} rate`}
                          value={rates[`${job.id}|${c.number}`] ?? ""}
                          onCommit={(t) => void save([c], t)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The Labor Rates Map: a card per job, grouped by Phase. Inside a job, codes group by division, collapsed. */
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
                onSaved={(codes, rate) =>
                  setRates((r) => {
                    const next = { ...r };
                    for (const code of codes) {
                      if (rate === null) delete next[`${j.id}|${code}`];
                      else next[`${j.id}|${code}`] = rate;
                    }
                    return next;
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
