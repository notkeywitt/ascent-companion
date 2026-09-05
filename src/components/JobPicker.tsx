"use client";

import { useEffect, useRef, useState } from "react";
import { PeakMark } from "@/components/PageTitle";

export interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string;
  address?: string;
  phase?: string | null;
}

/** Sentinel for "jobs with no Phase set", so it can sit in a plain <select> alongside real values. */
const NO_PHASE = "__no_phase__";

export const jobLabel = (j: JobRef) => (j.customer ? `${j.customer} - ${j.name}` : j.name);
/** Drop the trailing ", USA" Google tacks on — every job is domestic. */
export const jobAddress = (j: JobRef) => (j.address ?? "").replace(/,\s*USA$/i, "").trim();

/** Whole dollars — a dropdown row has space for the figure, not for its cents. */
const money0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
/** "2026-08" → "August 2026", for the caption over the amounts. */
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return "";
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

/**
 * Searchable dropdown of the org's jobs. `value` is the selected job id.
 * `onSelect` (optional) also hands back the full chosen job — or null for
 * "All jobs" — so a caller that needs the label doesn't have to fetch
 * /api/jobs a second time just to look it up.
 *
 * `onResolved` (optional) is the same job, but reported whenever the SELECTION
 * resolves rather than only when the user picks: on mount the id arrives from
 * the URL with the list still in flight, so `onSelect` never fires and a caller
 * that only listened to it would show nothing until the next manual pick. Use
 * this one to mirror the selected job outside the picker (the header's address
 * line); use `onSelect` for reacting to a deliberate change.
 *
 * By default it fetches /api/jobs itself (open jobs). A caller that already has
 * a list — /jobs holds a filtered one, so its dropdown and its filters can't
 * disagree — passes `jobs` instead and no fetch happens. `includeAll` /
 * `allLabel` / `allDescription` cover callers for whom "no selection" isn't the
 * draft-bills all-jobs view.
 *
 * `showPhaseFilter` adds a Phase <select> inside the dropdown, narrowing the
 * list the same way /jobs' own Phase filter does. Opt-in and off by default —
 * it's meaningful on the header's app-wide picker (many jobs, worth narrowing)
 * but would be noise on a single-purpose picker like the bill page's reassign-
 * job control. When on and no `jobs` prop is supplied, it fetches
 * /api/jobs?withPhase=1 instead of the plain /api/jobs — same "open jobs"
 * scope, with the Phase join added server-side as a separate cache entry so
 * the far more common plain read doesn't pay for it.
 *
 * `showToBeInvoiced` prints, beside each job, what that job still has to invoice
 * this billing month — so choosing a job to work is a decision made with the
 * money in view. Opt-in and off by default: it costs an org-wide bill scan, and
 * most pickers (mileage, requisitions, employee time) are field surfaces with no
 * business showing billing figures. The figures load when the dropdown FIRST
 * opens, not on mount, so a page that merely renders the header pays nothing.
 * Uninvoiced bills PLUS uninvoiced time, drafts included, invoiced ones dropped
 * — the same sum a job's own Tracking Sheets card shows, since a client invoice
 * pulls logged labor along with the bills.
 *
 * `variant="title"` draws the trigger as the PAGE HEADING instead of a form
 * control — peak mark, `<h1>`, one chevron — for a job-scoped page whose title
 * IS the job (Tracking Sheets). Same dropdown; only the closed state changes.
 * Pass it through `PageHeader`'s `titleSlot`, which skips the `PageTitle` this
 * variant renders itself.
 *
 * `fallbackLabel` is what the trigger reads while `value` names a job the list
 * hasn't loaded yet. Without it the raw job id shows, which is fine inside a
 * form control and wrong as a page title — a caller that already knows the
 * job's name (its own fetch) passes it here.
 */
export function JobPicker({
  value,
  onChange,
  onSelect,
  onResolved,
  jobs: jobsProp,
  includeAll = true,
  allLabel = "All jobs",
  allDescription = "Draft bills across every job",
  placeholder,
  fallbackLabel,
  showPhaseFilter = false,
  showToBeInvoiced = false,
  variant = "control",
}: {
  value: string;
  onChange: (id: string) => void;
  onSelect?: (job: JobRef | null) => void;
  onResolved?: (job: JobRef | null) => void;
  jobs?: JobRef[];
  includeAll?: boolean;
  allLabel?: string;
  allDescription?: string;
  placeholder?: string;
  fallbackLabel?: string;
  showPhaseFilter?: boolean;
  showToBeInvoiced?: boolean;
  variant?: "control" | "title";
}) {
  const [fetched, setFetched] = useState<JobRef[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Defaults to the "Active" phase on pickers that show the filter — most jobs
  // people are picking day to day are active ones, and PreCon/Prospective/
  // Complete jobs would otherwise clutter the list. Only meaningful (and only
  // ever populated with real phases) when showPhaseFilter fetched them.
  const [phaseFilter, setPhaseFilter] = useState(showPhaseFilter ? "Active" : "");
  const [loading, setLoading] = useState(!jobsProp);
  // jobId → what that job still has to invoice this billing month, plus the
  // month it covers. Null until the dropdown has been opened once.
  const [toInvoice, setToInvoice] = useState<{
    ym: string;
    totals: Record<string, number>;
    includesTime: boolean;
  } | null>(null);
  // Starts true on a picker that shows the figures: the fetch fires on the same
  // render as the first open, so a false start would flash "unavailable".
  const [toInvoiceLoading, setToInvoiceLoading] = useState(showToBeInvoiced);
  const askedToInvoice = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const jobs = jobsProp ?? fetched;

  useEffect(() => {
    if (jobsProp) return; // caller supplied the list — don't fetch
    fetch(showPhaseFilter ? "/api/jobs?withPhase=1" : "/api/jobs")
      .then((r) => r.json())
      .then((j) => setFetched(j.jobs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showPhaseFilter is
    // a mount-time choice of endpoint, not something a caller flips at runtime.
  }, [jobsProp]);

  // The money figures, fetched on the FIRST open and then kept — the scan behind
  // them pages the whole org's bills for the month, so it is not something to
  // repeat every time the list opens. A failure leaves the amounts off; the
  // picker still picks jobs.
  useEffect(() => {
    if (!showToBeInvoiced || !open || askedToInvoice.current) return;
    askedToInvoice.current = true;
    setToInvoiceLoading(true);
    fetch("/api/jobs/to-be-invoiced")
      .then((r) => r.json())
      .then((j) => {
        if (!j?.error)
          setToInvoice({
            ym: j.ym ?? "",
            totals: j.totals ?? {},
            includesTime: !!j.includesTime,
          });
      })
      .catch(() => {})
      .finally(() => setToInvoiceLoading(false));
  }, [showToBeInvoiced, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = jobs.find((j) => j.id === value);

  // Report the resolved selection upward. Keyed on the job's ID rather than the
  // object, so this fires once when the fetch finally matches the URL's ?jobId
  // and not on every render; the callback is held in a ref so a caller passing
  // an inline arrow (the common case) doesn't re-trigger it every render.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  useEffect(() => {
    onResolvedRef.current?.(selected ?? null);
  }, [selected?.id]);
  // Empty value == the all-jobs view (job-scoped pages read no ?jobId as "every
  // job"). Surface that as an explicit, selectable "All jobs" state.
  // A caller's own `placeholder` wins over "Loading jobs…": it is a deliberate
  // word for the empty state (Tracking Sheets' page title, say), and a title
  // that flickers through a loading message on every mount is worse than one
  // that simply names the page until you open it.
  const label = selected
    ? jobLabel(selected)
    : value
      ? (fallbackLabel ?? value) // e.g. arrived from the panel before jobs loaded
      : (placeholder ?? (loading ? "Loading jobs…" : allLabel));

  // Distinct phases present, for the filter <select> — only meaningful once
  // showPhaseFilter has actually fetched jobs carrying a `phase` field.
  const phases = showPhaseFilter
    ? [...new Set(jobs.map((j) => j.phase).filter((p): p is string => !!p))].sort((a, b) =>
        a.localeCompare(b),
      )
    : [];
  const hasNoPhase = showPhaseFilter && jobs.some((j) => !j.phase);

  const q = query.trim().toLowerCase();
  const filtered = jobs.filter((j) => {
    if (phaseFilter) {
      const phaseOk = phaseFilter === NO_PHASE ? !j.phase : j.phase === phaseFilter;
      if (!phaseOk) return false;
    }
    if (!q) return true;
    return `${j.customer ?? ""} ${j.number ?? ""} ${j.name} ${j.address ?? ""}`
      .toLowerCase()
      .includes(q);
  });

  const toggle = () => {
    setOpen((o) => !o);
    setQuery("");
  };

  // The closed state. Both variants are the same button with the same aria — a
  // title just wears the page heading's type instead of a field's border.
  const trigger =
    variant === "title" ? (
      <h1 className="flex min-w-0 items-center gap-2.5 text-xl font-bold tracking-tight">
        <PeakMark className="h-3.5 w-[22px] shrink-0" />
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggle}
          className="flex min-w-0 items-center gap-1.5 rounded text-left transition hover:text-accent"
        >
          {/* No grey-out for the empty state here: with no job picked the label
              is the PAGE'S NAME, which is not placeholder text. */}
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-base font-normal text-neutral-400">▾</span>
        </button>
      </h1>
    ) : (
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm transition hover:border-accent dark:border-neutral-600 dark:bg-ink-raised"
      >
        <span className={"truncate " + (selected ? "font-medium" : "text-neutral-400")}>{label}</span>
        <span className="text-neutral-400">▾</span>
      </button>
    );

  return (
    <div
      ref={ref}
      className="relative min-w-0 flex-1"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {trigger}

      {/* A title is only as wide as the job's name, and the toolbar beside it
          can leave that narrow — so the panel keeps its own floor there rather
          than inheriting a width that clips every address. */}
      {open && (
        <div
          className={`absolute z-30 mt-1 flex max-h-80 w-full flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-ink-overlay ${
            variant === "title" ? "min-w-[min(24rem,calc(100vw-2rem))]" : ""
          }`}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs…"
            className="border-b border-line bg-transparent px-3 py-2 text-sm outline-none dark:border-white/10"
          />
          {showPhaseFilter && phases.length > 0 && (
            <select
              value={phaseFilter}
              onChange={(e) => setPhaseFilter(e.target.value)}
              aria-label="Filter by phase"
              className="border-b border-line bg-transparent px-3 py-1.5 text-xs text-neutral-500 outline-none dark:border-white/10"
            >
              <option value="">All phases</option>
              {phases.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {hasNoPhase && <option value={NO_PHASE}>(No phase)</option>}
            </select>
          )}
          {/* What the amounts on the right ARE. Without this line the figure is
              a naked number: it is one month's uninvoiced bills and time, not
              the job's balance and not its budget. */}
          {showToBeInvoiced && (
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[11px] text-neutral-500 dark:border-white/10 dark:text-neutral-400">
              <span>
                To be invoiced{toInvoice?.ym ? ` · ${monthLabel(toInvoice.ym)}` : ""}
              </span>
              <span>
                {toInvoiceLoading
                  ? "checking JobTread…"
                  : !toInvoice
                    ? "unavailable"
                    : toInvoice.includesTime
                      ? "bills + time"
                      : "bills only"}
              </span>
            </div>
          )}
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{jobLabel(j)}</span>
                    {jobAddress(j) && (
                      <span className="block truncate text-xs text-neutral-500">
                        {jobAddress(j)}
                      </span>
                    )}
                  </span>
                  {/* Only jobs with something to invoice carry a figure — a
                      column of "$0" would say nothing and cost a line of width. */}
                  {showToBeInvoiced && !!toInvoice?.totals[j.id] && (
                    <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
                      {money0(toInvoice.totals[j.id])}
                    </span>
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
