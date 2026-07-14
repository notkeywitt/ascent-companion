"use client";

// Labor Import — turn the monthly QuickBooks Time labor report (a CSV export of
// the QBO/QB-Time sheet) into a CSV whose columns match JobTread's "Import Time
// Entries" mapper. Pure client-side: the file is parsed in the browser and never
// leaves it; no JobTread API calls. You filter which rows go in by Job and by
// Worker, map each job to its JT Job ID (JT refuses QB job *names* — they don't
// match 1:1 — so we emit the ID), then download the result and drop it into JT.

import { useEffect, useMemo, useState } from "react";

// ---- Editable config -------------------------------------------------------

// JobTread keys a worker on their FIRST NAME (the "User Name" field in the
// importer). Where JT's first name differs from the QB `fname`, map it here
// (keys are lowercased QB first names). Anyone not listed passes through as-is.
const NAME_MAP: Record<string, string> = {
  thomas: "Tommy",
  tyler: "Ty",
};

// Job names matching this are internal overhead (not a client job) and are
// UNCHECKED by default — "client jobs only".
const INTERNAL_JOB = /^ascent$/i;

// Hours-only rows (no clock in/out) get a synthetic workday starting here.
const DEFAULT_START_HOUR = 8;

const DEFAULT_TYPE = "Regular Pay";

// The output header row, named to match JobTread's importer fields exactly.
const JT_HEADERS = [
  "User Name",
  "Start",
  "End",
  "Job ID",
  "Cost Item Name",
  "Notes",
  "Type",
  "Approved",
] as const;

const JOB_ID_STORE = "laborImport.jobIdMap.v1";

// A JobTread job from the read-only /api/jobs endpoint (for the picker).
interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string;
}

// Loose match key so "Bill & Amy Ferron" (QB) lines up with "Bill and Amy
// Ferron" (JT): lowercase, & → and, drop punctuation, collapse spaces.
const normJob = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---- CSV parsing -----------------------------------------------------------

/** RFC-4180-ish parser: handles quoted fields, doubled quotes, embedded
 * commas/newlines, and CRLF. Returns rows of raw string cells. */
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const norm = (s: string) => (s ?? "").trim().toLowerCase();

/** QB Time exports sometimes carry a blank/title line before the header. Find
 * the row that actually holds the column names. */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const set = new Set(rows[i].map(norm));
    if (set.has("username") || (set.has("jobcode_1") && set.has("hours"))) return i;
  }
  return 0;
}

// ---- Time helpers ----------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `2026-06-16` + start hour → `2026-06-16 8:00:00`. */
function synthStart(date: string): string {
  return `${date} ${DEFAULT_START_HOUR}:00:00`;
}

/** `2026-06-16` + 3.45 decimal hours from the start hour → `2026-06-16 11:27:00`. */
function synthEnd(date: string, hours: number): string {
  const total = DEFAULT_START_HOUR * 60 + Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${date} ${h}:${pad2(m)}:00`;
}

// ---- Row model -------------------------------------------------------------

interface Entry {
  idx: number;
  worker: string; // full "First Last" — the filter/label key
  userName: string; // JT first-name value emitted to the CSV
  jobRaw: string; // QB jobcode_1 — the job filter key + Job ID map key
  serviceItem: string;
  start: string;
  end: string;
  notes: string;
  approved: string; // "Yes" / "No"
  hours: number;
  invalidReason: string; // "" when the row can be emitted (given a Job ID)
}

function buildEntries(rows: string[][]): Entry[] {
  const h = findHeaderRow(rows);
  const header = rows[h].map(norm);
  const col = (name: string) => header.indexOf(name);
  const c = {
    username: col("username"),
    fname: col("fname"),
    lname: col("lname"),
    date: col("local_date"),
    start: col("local_start_time"),
    end: col("local_end_time"),
    hours: col("hours"),
    job1: col("jobcode_1"),
    service: col("service item"),
    notes: col("notes"),
    approved: col("approved_status"),
  };
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  const out: Entry[] = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => (v ?? "").trim() === "")) continue; // blank line

    const fname = get(row, c.fname);
    const lname = get(row, c.lname);
    const username = get(row, c.username);
    const worker = `${fname} ${lname}`.trim() || username;
    const userName = NAME_MAP[norm(fname)] ?? fname;

    const jobRaw = get(row, c.job1);
    const serviceItem = get(row, c.service);
    const date = get(row, c.date);
    const hours = parseFloat(get(row, c.hours)) || 0;
    let start = get(row, c.start);
    let end = get(row, c.end);
    if (!start && !end && date && hours > 0) {
      start = synthStart(date);
      end = synthEnd(date, hours);
    }
    const approved = /^approved$/i.test(get(row, c.approved)) ? "Yes" : "No";

    let invalidReason = "";
    if (!serviceItem) invalidReason = "no service item / cost code";
    else if (!start || !end) invalidReason = "no start/end time and no hours";

    out.push({
      idx: r,
      worker,
      userName,
      jobRaw,
      serviceItem,
      start,
      end,
      notes: get(row, c.notes),
      approved,
      hours,
      invalidReason,
    });
  }
  return out;
}

// ---- CSV building ----------------------------------------------------------

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function buildCsv(entries: Entry[], jobId: (jobRaw: string) => string): string {
  const lines = [JT_HEADERS.join(",")];
  for (const e of entries) {
    const cells = [
      e.userName,
      e.start,
      e.end,
      jobId(e.jobRaw),
      e.serviceItem,
      e.notes,
      DEFAULT_TYPE,
      e.approved,
    ];
    lines.push(cells.map((x) => csvField(x ?? "")).join(","));
  }
  return lines.join("\r\n");
}

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Page ------------------------------------------------------------------

export default function LaborImportPage() {
  const [fileName, setFileName] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [selJobs, setSelJobs] = useState<Set<string>>(new Set());
  const [selWorkers, setSelWorkers] = useState<Set<string>>(new Set());
  const [jobIdMap, setJobIdMap] = useState<Record<string, string>>({});

  // JobTread jobs for the picker (read-only). Falls back to manual entry if the
  // fetch fails (no grant, offline) or a job isn't in the open-jobs list.
  const [jtJobs, setJtJobs] = useState<JobRef[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState("");
  const [manualJobs, setManualJobs] = useState<Set<string>>(new Set());

  // Load remembered Job IDs.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_ID_STORE);
      if (raw) setJobIdMap(JSON.parse(raw));
    } catch {}
  }, []);

  function setJobId(jobRaw: string, id: string) {
    setJobIdMap((prev) => {
      const next = { ...prev, [jobRaw]: id };
      try {
        localStorage.setItem(JOB_ID_STORE, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  // Fetch JobTread's open jobs once a file is loaded (for the picker dropdown).
  useEffect(() => {
    if (!entries || jtJobs || jobsLoading || jobsError) return;
    setJobsLoading(true);
    fetch("/api/jobs")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Failed to load jobs");
        return (j.jobs ?? []) as JobRef[];
      })
      .then(setJtJobs)
      .catch((e) => setJobsError(e instanceof Error ? e.message : "Could not load JobTread jobs"))
      .finally(() => setJobsLoading(false));
  }, [entries, jtJobs, jobsLoading, jobsError]);

  // Best-effort auto-match: for any selected job with no ID yet, fill in a
  // confident name/customer match. Never overwrites an existing choice.
  useEffect(() => {
    if (!jtJobs || !entries) return;
    setJobIdMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const job of new Set(entries.map((e) => e.jobRaw).filter(Boolean))) {
        if ((next[job] ?? "").trim()) continue;
        const n = normJob(job);
        const hit = jtJobs.find((j) => normJob(j.name) === n || normJob(j.customer ?? "") === n);
        if (hit) {
          next[job] = hit.id;
          changed = true;
        }
      }
      if (changed) {
        try {
          localStorage.setItem(JOB_ID_STORE, JSON.stringify(next));
        } catch {}
      }
      return changed ? next : prev;
    });
  }, [jtJobs, entries]);

  const setManual = (job: string, on: boolean) =>
    setManualJobs((prev) => {
      const next = new Set(prev);
      on ? next.add(job) : next.delete(job);
      return next;
    });

  async function loadFile(file: File) {
    setParseError("");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const es = buildEntries(rows);
      if (es.length === 0) {
        setParseError("No data rows found. Is this the QuickBooks Time labor CSV?");
        return;
      }
      setFileName(file.name);
      setEntries(es);
      // Default filters: every worker; every job EXCEPT internal "Ascent".
      const jobs = new Set(es.map((e) => e.jobRaw).filter(Boolean));
      setSelJobs(new Set([...jobs].filter((j) => !INTERNAL_JOB.test(j))));
      setSelWorkers(new Set(es.map((e) => e.worker).filter(Boolean)));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read the file.");
    }
  }

  // Distinct jobs / workers (with counts) for the filter lists.
  const jobList = useMemo(() => tally(entries, (e) => e.jobRaw), [entries]);
  const workerList = useMemo(() => tally(entries, (e) => e.worker), [entries]);

  // Rows passing the filters and valid enough to emit (given a Job ID).
  const selected = useMemo(
    () =>
      (entries ?? []).filter(
        (e) => !e.invalidReason && selJobs.has(e.jobRaw) && selWorkers.has(e.worker),
      ),
    [entries, selJobs, selWorkers],
  );

  // Of the selected rows, which are export-ready (their job has a JT Job ID).
  const ready = useMemo(
    () => selected.filter((e) => (jobIdMap[e.jobRaw] ?? "").trim()),
    [selected, jobIdMap],
  );

  // Jobs currently in the filter that still need a JT Job ID.
  const jobsNeedingId = useMemo(
    () => [...selJobs].filter((j) => !(jobIdMap[j] ?? "").trim()).sort(),
    [selJobs, jobIdMap],
  );

  const dropped = useMemo(
    () => (entries ?? []).filter((e) => e.invalidReason),
    [entries],
  );

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  function doDownload() {
    if (ready.length === 0) return;
    const base = fileName.replace(/\.[^.]+$/, "") || "labor";
    download(`${base} - JT import.csv`, buildCsv(ready, (j) => (jobIdMap[j] ?? "").trim()));
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <header className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Ascent Companion
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Labor Import</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Turn the monthly QuickBooks labor report into a JobTread time-entry import CSV. The file
          is processed in your browser only.
        </p>
      </header>

      {parseError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {parseError}
        </div>
      )}

      {!entries && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) loadFile(f);
          }}
          className={
            "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition " +
            (dragOver
              ? "border-accent bg-accent/5"
              : "border-neutral-300 hover:border-accent dark:border-neutral-700")
          }
        >
          <span className="text-sm font-medium">Drop the labor CSV here</span>
          <span className="mt-1 text-xs text-neutral-500">
            or click to choose — export the QBO report as CSV first (File → Download → CSV)
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
            }}
          />
        </label>
      )}

      {entries && (
        <>
          {/* Summary + download */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="text-sm">
              <div className="font-medium">{fileName}</div>
              <div className="text-xs text-neutral-500">
                {ready.length} ready · {selected.length - ready.length} awaiting Job ID ·{" "}
                {dropped.length} dropped · {entries.length} total
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEntries(null);
                  setFileName("");
                }}
                className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                Load another
              </button>
              <button
                onClick={doDownload}
                disabled={ready.length === 0}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download CSV ({ready.length})
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-5 grid gap-4 sm:grid-cols-2">
            <FilterCard title="Jobs (client jobs only by default)">
              {jobList.map(([job, n]) => (
                <CheckRow
                  key={job || "(blank)"}
                  checked={selJobs.has(job)}
                  onChange={() => toggle(selJobs, job, setSelJobs)}
                  label={job || "(blank)"}
                  count={n}
                  muted={INTERNAL_JOB.test(job)}
                />
              ))}
            </FilterCard>
            <FilterCard title="Workers">
              {workerList.map(([w, n]) => (
                <CheckRow
                  key={w || "(blank)"}
                  checked={selWorkers.has(w)}
                  onChange={() => toggle(selWorkers, w, setSelWorkers)}
                  label={w || "(blank)"}
                  count={n}
                />
              ))}
            </FilterCard>
          </div>

          {/* Job ID mapping — only for jobs currently selected */}
          {[...selJobs].length > 0 && (
            <div className="mb-5 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-2 text-sm font-semibold">
                JobTread Job IDs
                {jobsNeedingId.length > 0 && (
                  <span className="ml-2 font-normal text-amber-600 dark:text-amber-400">
                    {jobsNeedingId.length} missing — those rows are held back
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-neutral-500">
                JobTread rejects QB job names, so we emit the Job ID. Pick each QB job&apos;s matching
                JobTread job below — confident name matches are filled in automatically.{" "}
                {jobsLoading && "Loading JobTread jobs…"}
                {jobsError && (
                  <span className="text-amber-600 dark:text-amber-400">
                    Couldn&apos;t load jobs ({jobsError}) — enter IDs manually.
                  </span>
                )}{" "}
                Remembered on this device.
              </p>
              <div className="space-y-2">
                {[...selJobs].sort().map((job) => (
                  <div key={job} className="flex items-center gap-2">
                    <span className="w-48 shrink-0 truncate text-sm" title={job}>
                      {job || "(blank)"}
                    </span>
                    <JobIdControl
                      job={job}
                      jtJobs={jtJobs}
                      value={jobIdMap[job] ?? ""}
                      manual={manualJobs.has(job)}
                      onSet={(v) => setJobId(job, v)}
                      onManual={(on) => setManual(job, on)}
                    />
                    {(jobIdMap[job] ?? "").trim() ? (
                      <span className="text-accent">✓</span>
                    ) : (
                      <span className="text-amber-500">needs ID</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dropped rows */}
          {dropped.length > 0 && (
            <details className="mb-5 rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
              <summary className="cursor-pointer font-medium text-neutral-600 dark:text-neutral-300">
                {dropped.length} row{dropped.length === 1 ? "" : "s"} dropped (can&apos;t be imported)
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-neutral-500">
                {dropped.slice(0, 50).map((e) => (
                  <li key={e.idx}>
                    {e.worker} · {e.jobRaw || "(no job)"} · {e.notes.slice(0, 40)} —{" "}
                    <span className="text-amber-600 dark:text-amber-400">{e.invalidReason}</span>
                  </li>
                ))}
                {dropped.length > 50 && <li>… and {dropped.length - 50} more</li>}
              </ul>
            </details>
          )}

          {/* Preview */}
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-100 dark:bg-neutral-800">
                <tr>
                  {JT_HEADERS.map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ready.slice(0, 100).map((e) => (
                  <tr key={e.idx} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-2 py-1 whitespace-nowrap">{e.userName}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{e.start}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{e.end}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono">{jobIdMap[e.jobRaw]}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{e.serviceItem}</td>
                    <td className="max-w-[16rem] truncate px-2 py-1" title={e.notes}>
                      {e.notes}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{DEFAULT_TYPE}</td>
                    <td className="px-2 py-1">{e.approved}</td>
                  </tr>
                ))}
                {ready.length === 0 && (
                  <tr>
                    <td
                      colSpan={JT_HEADERS.length}
                      className="px-2 py-6 text-center text-neutral-500"
                    >
                      Nothing ready yet — check a job/worker above and give each selected job a JT
                      Job ID.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {ready.length > 100 && (
            <p className="mt-2 text-xs text-neutral-500">
              Showing first 100 of {ready.length} — the download includes all.
            </p>
          )}
        </>
      )}
    </main>
  );
}

// ---- Small presentational helpers ------------------------------------------

function tally(entries: Entry[] | null, key: (e: Entry) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const e of entries ?? []) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// A JobTread job selector: a dropdown of JT jobs when the list is available,
// with an "Enter ID manually…" escape hatch (and the sole control when the jobs
// list couldn't be fetched or the job is closed/unlisted).
function JobIdControl({
  job,
  jtJobs,
  value,
  manual,
  onSet,
  onManual,
}: {
  job: string;
  jtJobs: JobRef[] | null;
  value: string;
  manual: boolean;
  onSet: (v: string) => void;
  onManual: (on: boolean) => void;
}) {
  const cls =
    "flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-accent dark:border-neutral-700";

  if (jtJobs && jtJobs.length > 0 && !manual) {
    const known = jtJobs.some((j) => j.id === value);
    return (
      <select
        value={value || ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__manual__") onManual(true);
          else onSet(v);
        }}
        className={cls}
        title={job}
      >
        <option value="">— pick JobTread job —</option>
        {value && !known && <option value={value}>Saved: {value}</option>}
        {jtJobs.map((j) => (
          <option key={j.id} value={j.id}>
            {(j.customer ? j.customer + " — " : "") + j.name + (j.number ? " (#" + j.number + ")" : "")}
          </option>
        ))}
        <option value="__manual__">Enter ID manually…</option>
      </select>
    );
  }

  return (
    <span className="flex flex-1 items-center gap-2">
      <input
        value={value}
        onChange={(e) => onSet(e.target.value.trim())}
        placeholder="JT Job ID"
        className={cls + " font-mono"}
      />
      {jtJobs && jtJobs.length > 0 && (
        <button
          type="button"
          onClick={() => onManual(false)}
          className="whitespace-nowrap text-xs text-accent"
        >
          use list
        </button>
      )}
    </span>
  );
}

function FilterCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="max-h-56 space-y-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  count,
  muted,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  count: number;
  muted?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent" />
      <span className={"flex-1 truncate " + (muted ? "text-neutral-400" : "")} title={label}>
        {label}
      </span>
      <span className="text-xs text-neutral-400">{count}</span>
    </label>
  );
}
