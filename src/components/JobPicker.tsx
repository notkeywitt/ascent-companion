"use client";

import { useEffect, useRef, useState } from "react";

export interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string;
  address?: string;
}

const jobLabel = (j: JobRef) => (j.customer ? `${j.customer} - ${j.name}` : j.name);
// Drop the trailing ", USA" Google tacks on — every job is domestic.
const jobAddress = (j: JobRef) => (j.address ?? "").replace(/,\s*USA$/i, "").trim();

/**
 * Searchable dropdown of the org's jobs. `value` is the selected job id.
 * `onSelect` (optional) also hands back the full chosen job — or null for
 * "All jobs" — so a caller that needs the label doesn't have to fetch
 * /api/jobs a second time just to look it up.
 *
 * By default it fetches /api/jobs itself (open jobs). A caller that already has
 * a list — /jobs holds a filtered one, so its dropdown and its filters can't
 * disagree — passes `jobs` instead and no fetch happens. `includeAll` /
 * `allLabel` / `allDescription` cover callers for whom "no selection" isn't the
 * draft-bills all-jobs view.
 */
export function JobPicker({
  value,
  onChange,
  onSelect,
  jobs: jobsProp,
  includeAll = true,
  allLabel = "All jobs",
  allDescription = "Draft bills across every job",
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  onSelect?: (job: JobRef | null) => void;
  jobs?: JobRef[];
  includeAll?: boolean;
  allLabel?: string;
  allDescription?: string;
  placeholder?: string;
}) {
  const [fetched, setFetched] = useState<JobRef[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!jobsProp);
  const ref = useRef<HTMLDivElement>(null);

  const jobs = jobsProp ?? fetched;

  useEffect(() => {
    if (jobsProp) return; // caller supplied the list — don't fetch
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => setFetched(j.jobs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [jobsProp]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = jobs.find((j) => j.id === value);
  // Empty value == the all-jobs view (job-scoped pages read no ?jobId as "every
  // job"). Surface that as an explicit, selectable "All jobs" state.
  const label = selected
    ? jobLabel(selected)
    : value
      ? value // e.g. arrived from the panel before jobs loaded
      : loading
        ? "Loading jobs…"
        : (placeholder ?? allLabel);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) =>
        `${j.customer ?? ""} ${j.number ?? ""} ${j.name} ${j.address ?? ""}`
          .toLowerCase()
          .includes(q),
      )
    : jobs;

  return (
    <div
      ref={ref}
      className="relative flex-1"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm transition hover:border-accent dark:border-neutral-600 dark:bg-ink-raised"
      >
        <span className={"truncate " + (selected ? "font-medium" : "text-neutral-400")}>{label}</span>
        <span className="text-neutral-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 flex max-h-80 w-full flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-ink-overlay">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs…"
            className="border-b border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/10"
          />
          <ul className="overflow-auto">
            {!q && includeAll && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    onSelect?.(null);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-white/5 ${
                    value ? "" : "bg-neutral-100 dark:bg-white/10"
                  }`}
                >
                  <span className="block truncate text-sm font-medium">{allLabel}</span>
                  <span className="block truncate text-xs text-neutral-500">{allDescription}</span>
                </button>
              </li>
            )}
            {filtered.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(j.id);
                    onSelect?.(j);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-white/5"
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
