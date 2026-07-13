"use client";

import { useEffect, useRef, useState } from "react";

interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string;
  address?: string;
}

const jobLabel = (j: JobRef) => (j.customer ? `${j.customer} - ${j.name}` : j.name);
// Drop the trailing ", USA" Google tacks on — every job is domestic.
const jobAddress = (j: JobRef) => (j.address ?? "").replace(/,\s*USA$/i, "").trim();

/** Searchable dropdown of the org's jobs. `value` is the selected job id. */
export function JobPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = jobs.find((j) => j.id === value);
  const label = selected
    ? jobLabel(selected)
    : value
      ? value // e.g. arrived from the panel before jobs loaded
      : loading
        ? "Loading jobs…"
        : "Select a job…";

  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) =>
        `${j.customer ?? ""} ${j.number ?? ""} ${j.name} ${j.address ?? ""}`
          .toLowerCase()
          .includes(q),
      )
    : jobs;

  return (
    <div ref={ref} className="relative flex-1">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm dark:border-neutral-700 dark:bg-neutral-900"
      >
        <span className={selected ? "font-medium" : "text-neutral-400"}>{label}</span>
        <span className="text-neutral-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 flex max-h-80 w-full flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs…"
            className="border-b border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-neutral-800"
          />
          <ul className="overflow-auto">
            {filtered.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(j.id);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="block truncate text-sm">{jobLabel(j)}</span>
                  {jobAddress(j) && (
                    <span className="block truncate text-xs text-neutral-500">{jobAddress(j)}</span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-neutral-500">
                {loading ? "Loading…" : "No matching job"}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
