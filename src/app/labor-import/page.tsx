"use client";

// Labor Import — turn the monthly QuickBooks Time labor report (a CSV export of
// the QBO/QB-Time sheet) into a CSV whose columns match JobTread's "Import Time
// Entries" mapper. Pure client-side: the file is parsed in the browser and never
// leaves it; no JobTread API calls. You filter which rows go in by Job and by
// Worker, map each job to its JT Job ID (JT refuses QB job *names* — they don't
// match 1:1 — so we emit the ID), then download the result and drop it into JT.

import { useEffect, useMemo, useState } from "react";

// ---- Editable config -------------------------------------------------------

// Job names matching this are internal overhead (not a client job) and are
// UNCHECKED by default — "client jobs only".
const INTERNAL_JOB = /^ascent$/i;

// Hours-only rows (no clock in/out) get a synthetic workday starting here.
const DEFAULT_START_HOUR = 8;

// NOTE: there is deliberately no default `Type`. A time entry's type is a PAY
// TYPE, each member has their own set, and they're job-scoped (different rates on
// different jobs) — e.g. "Regular Pay" isn't even available to Ty O'Steen. So it
// is chosen per (worker × job), never assumed.

// The output header row, named to match JobTread's importer fields exactly.
// `User ID` is the one to map in JobTread — it's unambiguous. `User Name` is
// emitted too, carrying JT's REAL display name (read from the org roster, never
// synthesised), so mapping that column works as well.
const JT_HEADERS = [
  "User ID",
  "User Name",
  "Start",
  "End",
  "Job ID",
  "Cost Item ID",
  "Notes",
  "Type",
  "Approved",
] as const;

const JOB_ID_STORE = "laborImport.jobIdMap.v1";
const WORKER_ID_STORE = "laborImport.workerIdMap.v1";
const TYPE_STORE = "laborImport.typeMap.v1";

// A pay type is picked per worker AND per job, so key the choice on both.
const typeKey = (worker: string, jobRaw: string) => `${worker}|||${jobRaw}`;
const PROJECTS_MAP_STORE = "laborImport.projectsMap.v2"; // v2: ProjectLink (multi-id), not a bare id

// A JobTread job from the read-only /api/jobs endpoint (for the picker).
interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string;
}

// A JobTread user from the read-only /api/jt-users endpoint.
interface PayType {
  name: string;
  hourlyRate?: number;
}
interface UserRef {
  id: string;
  name: string;
  isInternal: boolean;
  types?: PayType[]; // that member's own pay types; absent if the grant can't read them
}

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

// Loose join key: lowercase, keep only alphanumerics. Lets a labor value line up
// with a Projects `jobcode_1` regardless of spacing/punctuation differences.
const keyOf = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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

/**
 * Normalise a QB local timestamp to ISO 8601 for JobTread's importer:
 * `2026-06-01 8:00:00` → `2026-06-01T08:00:00`. A space separator / single-digit
 * hour isn't ISO, and JT's importer rejects it (falling back to "now").
 *
 * NO timezone offset on purpose. A real JT entry stores its start as
 * `2026-07-10T13:24:00.000Z` for an afternoon session — i.e. JT keeps the local
 * wall-clock time as-if-UTC (floating), so we hand it the local time unshifted.
 */
function toIso(local: string): string {
  const t = (local ?? "").trim();
  if (!t) return "";
  const [d, time = ""] = t.split(/[ T]+/);
  const [hh = "0", mm = "0", ss = "0"] = time.split(":");
  return `${d}T${pad2(+hh)}:${pad2(+mm)}:${pad2(+ss)}`;
}

// ---- Row model -------------------------------------------------------------

interface Entry {
  idx: number;
  worker: string; // full "First Last" — the filter key + the key of the worker→JT-user map
  fname: string; // QB first name (only used to auto-match against JT display names)
  job1: string; // jobcode_1 = the CUSTOMER
  job2: string; // jobcode_2 = the specific JOB (blank when that customer has only one)
  jobRaw: string; // "Customer — Job" (or just Customer) — the filter key + Job ID map key
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
    job2: col("jobcode_2"),
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

    // jobcode_1 is the CUSTOMER; jobcode_2 is the specific JOB (blank when the
    // customer has only one). jobcode_3 is an activity, not a job — ignored.
    const job1 = get(row, c.job1);
    const job2 = get(row, c.job2);
    const jobRaw = job2 ? `${job1} — ${job2}` : job1;
    const serviceItem = get(row, c.service);
    const date = get(row, c.date);
    const hours = parseFloat(get(row, c.hours)) || 0;
    let start = get(row, c.start);
    let end = get(row, c.end);
    if (!start && !end && date && hours > 0) {
      start = synthStart(date);
      end = synthEnd(date, hours);
    }
    start = toIso(start);
    end = toIso(end);
    const approved = /^approved$/i.test(get(row, c.approved)) ? "Yes" : "No";

    let invalidReason = "";
    if (!serviceItem) invalidReason = "no service item / cost code";
    else if (!start || !end) invalidReason = "no start/end time and no hours";

    out.push({
      idx: r,
      worker,
      fname,
      job1,
      job2,
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

/**
 * Every JobTread job a single `jobcode_1` points at. The Projects tab is
 * CUSTOMER-level, so one customer can have several rows (one per JT job) — e.g.
 * Moon Spring Farm LLC → Pole Barn + Main House. Collecting them all (instead of
 * last-one-wins) is what lets us refuse to auto-fill an ambiguous customer.
 */
interface ProjectLink {
  ids: string[]; // distinct JobTread Job IDs
  labels: string[]; // their Project names, parallel to ids
}

// Parse the exported Project Database "Projects" tab → { jobcode_1: ProjectLink }.
function parseProjectsMap(text: string): Record<string, ProjectLink> {
  const rows = parseCsv(text);
  let h = -1;
  for (let i = 0; i < rows.length; i++) {
    const set = new Set(rows[i].map(norm));
    if (set.has("jobcode_1") && set.has("jobtread job id")) {
      h = i;
      break;
    }
  }
  if (h < 0) throw new Error("Couldn't find both 'jobcode_1' and 'JobTread Job ID' columns.");
  const header = rows[h].map(norm);
  const jc = header.indexOf("jobcode_1");
  const jt = header.indexOf("jobtread job id");
  const pj = header.indexOf("project");

  const map: Record<string, ProjectLink> = {};
  for (let r = h + 1; r < rows.length; r++) {
    const key = keyOf(rows[r][jc] ?? "");
    const id = (rows[r][jt] ?? "").trim();
    if (!key || !id) continue;
    const label = pj >= 0 ? (rows[r][pj] ?? "").trim() : "";
    const link = (map[key] ??= { ids: [], labels: [] });
    if (!link.ids.includes(id)) {
      link.ids.push(id);
      link.labels.push(label || id);
    }
  }
  return map;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * A job's cost-code → costItemId map, resolved for one CSI. Mirrors the Apps
 * Script resolver: exact code first, then a CSI pattern embedded in a longer
 * label like "01 31 20 Project Management".
 */
function matchCostItem(byCode: Record<string, string>, rawCsi: string): string {
  const raw = (rawCsi ?? "").trim();
  if (!raw) return "";
  if (byCode[raw]) return byCode[raw];
  const m = raw.match(/\d{2}\s+\d{2}\s+\d{2}(?:\.\d+)?/);
  if (m) {
    const n = m[0].replace(/\s+/g, " ").trim();
    if (byCode[n]) return byCode[n];
  }
  return "";
}

function buildCsv(
  entries: Entry[],
  resolve: (e: Entry) => {
    userId: string;
    userName: string;
    jobId: string;
    costItemId: string;
    type: string;
  },
): string {
  const lines = [JT_HEADERS.join(",")];
  for (const e of entries) {
    const { userId, userName, jobId, costItemId, type } = resolve(e);
    const cells = [
      userId,
      userName,
      e.start,
      e.end,
      jobId,
      costItemId,
      e.notes,
      type,
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

  // JobTread users + the QB worker → JT user id map.
  const [jtUsers, setJtUsers] = useState<UserRef[] | null>(null);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [usersError, setUsersError] = useState("");
  const [workerIdMap, setWorkerIdMap] = useState<Record<string, string>>({});
  // (worker|||job) → pay-type name.
  const [typeMap, setTypeMap] = useState<Record<string, string>>({});

  // jobcode_1 → the JobTread job(s) it points at, from the exported Projects tab CSV.
  const [projectsMap, setProjectsMap] = useState<Record<string, ProjectLink>>({});
  const [projectsMeta, setProjectsMeta] = useState<{ name: string; count: number } | null>(null);
  const [projectsErr, setProjectsErr] = useState("");

  // JobTread cost items are PER-JOB: { jobId: { costCode: costItemId } }.
  const [budgets, setBudgets] = useState<Record<string, Record<string, string>>>({});
  const [budgetsLoading, setBudgetsLoading] = useState(false);
  const [budgetsErr, setBudgetsErr] = useState("");

  // Load remembered Job IDs + the remembered Projects map.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_ID_STORE);
      if (raw) setJobIdMap(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem(PROJECTS_MAP_STORE);
      if (raw) {
        const saved = JSON.parse(raw);
        setProjectsMap(saved.map ?? {});
        setProjectsMeta(saved.meta ?? null);
      }
    } catch {}
    try {
      const raw = localStorage.getItem(WORKER_ID_STORE);
      if (raw) setWorkerIdMap(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem(TYPE_STORE);
      if (raw) setTypeMap(JSON.parse(raw));
    } catch {}
  }, []);

  function setWorkerId(worker: string, id: string) {
    setWorkerIdMap((prev) => {
      const next = { ...prev, [worker]: id };
      try {
        localStorage.setItem(WORKER_ID_STORE, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function setType(worker: string, jobRaw: string, name: string) {
    setTypeMap((prev) => {
      const next = { ...prev, [typeKey(worker, jobRaw)]: name };
      try {
        localStorage.setItem(TYPE_STORE, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

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

  // Fetch the JobTread user roster once a file is loaded.
  useEffect(() => {
    if (!entries || jtUsers || usersError) return;
    fetch("/api/jt-users")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Failed to load JobTread users");
        return j as { users: UserRef[]; orgTypes?: string[] };
      })
      .then((j) => {
        setJtUsers(j.users ?? []);
        setOrgTypes(j.orgTypes ?? []);
      })
      .catch((e) =>
        setUsersError(e instanceof Error ? e.message : "Could not load JobTread users"),
      );
  }, [entries, jtUsers, usersError]);

  // Auto-match a worker to a JT user ONLY on an exact name hit — the QB first
  // name ("Cedar") or full name. Anything looser would mis-key people like
  // Tyler O'Steen → "Ty O'Steen" or Thomas Hedley → "Tommy", so those are left
  // for a one-time pick instead of a guess.
  useEffect(() => {
    if (!jtUsers || !entries) return;
    setWorkerIdMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const e of entries) {
        if (!e.worker || (next[e.worker] ?? "").trim()) continue;
        const hit = jtUsers.find(
          (u) => keyOf(u.name) === keyOf(e.fname) || keyOf(u.name) === keyOf(e.worker),
        );
        if (hit) {
          next[e.worker] = hit.id;
          changed = true;
        }
      }
      if (changed) {
        try {
          localStorage.setItem(WORKER_ID_STORE, JSON.stringify(next));
        } catch {}
      }
      return changed ? next : prev;
    });
  }, [jtUsers, entries]);

  const userIdFor = (worker: string) => (workerIdMap[worker] ?? "").trim();
  const jtUserFor = (worker: string) => {
    const id = userIdFor(worker);
    return id ? (jtUsers?.find((u) => u.id === id) ?? null) : null;
  };
  const userNameFor = (worker: string) => jtUserFor(worker)?.name ?? "";

  /**
   * The pay types this worker may use. Their OWN set when the grant can read it
   * (each member has different types, at different rates); otherwise every type
   * on the org, since we can't tell which are theirs.
   */
  const typeOptionsFor = (worker: string): PayType[] => {
    const u = jtUserFor(worker);
    if (u?.types) return u.types;
    return orgTypes.map((name) => ({ name }));
  };

  /**
   * A row's `type`. Chosen per (worker × job) — types are job-scoped and vary by
   * person, so nothing is assumed. Auto-filled only when the worker has exactly
   * one option (then there's nothing to choose).
   */
  const typeFor = (e: Entry) => {
    const picked = (typeMap[typeKey(e.worker, e.jobRaw)] ?? "").trim();
    if (picked) return picked;
    const opts = typeOptionsFor(e.worker);
    return opts.length === 1 ? opts[0].name : "";
  };

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
      // Default filters: every worker; every job EXCEPT internal "Ascent" overhead
      // (tested on jobcode_1, since the key is now "Customer — Job").
      const internal = new Set(es.filter((e) => INTERNAL_JOB.test(e.job1)).map((e) => e.jobRaw));
      const jobs = new Set(es.map((e) => e.jobRaw).filter(Boolean));
      setSelJobs(new Set([...jobs].filter((j) => !internal.has(j))));
      setSelWorkers(new Set(es.map((e) => e.worker).filter(Boolean)));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read the file.");
    }
  }

  async function loadProjectsFile(file: File) {
    setProjectsErr("");
    try {
      const map = parseProjectsMap(await file.text());
      const meta = { name: file.name, count: Object.keys(map).length };
      setProjectsMap(map);
      setProjectsMeta(meta);
      try {
        localStorage.setItem(PROJECTS_MAP_STORE, JSON.stringify({ map, meta }));
      } catch {}
    } catch (e) {
      setProjectsErr(e instanceof Error ? e.message : "Couldn't read that mapping CSV.");
    }
  }

  // Composite job key → its parts (customer, job).
  const jobInfo = useMemo(() => {
    const m = new Map<string, { job1: string; job2: string }>();
    for (const e of entries ?? []) {
      if (!m.has(e.jobRaw)) m.set(e.jobRaw, { job1: e.job1, job2: e.job2 });
    }
    return m;
  }, [entries]);

  // Internal "Ascent" overhead jobs (unchecked by default).
  const internalJobs = useMemo(
    () => new Set((entries ?? []).filter((e) => INTERNAL_JOB.test(e.job1)).map((e) => e.jobRaw)),
    [entries],
  );

  // The Projects rows this job could point at: an exact "Customer — Job" hit if
  // the tab ever gets per-job jobcode_1 values, else the customer's row(s).
  const projectsLink = (jobRaw: string): ProjectLink | undefined => {
    const direct = projectsMap[keyOf(jobRaw)];
    if (direct) return direct;
    const info = jobInfo.get(jobRaw);
    return info ? projectsMap[keyOf(info.job1)] : undefined;
  };

  /**
   * Auto-fill ONLY when the link is unambiguous — exactly one JobTread job.
   *
   * The Projects tab is customer-level, so a customer with several JT jobs (Moon
   * Spring Farm → Pole Barn + Main House; Velorum → 3 jobs) resolves to multiple
   * ids. Picking one would silently put the hours on the wrong job's budget, so
   * we resolve to nothing and make you choose once instead.
   */
  const projectsId = (jobRaw: string) => {
    const link = projectsLink(jobRaw);
    return link && link.ids.length === 1 ? link.ids[0] : "";
  };

  // Non-null when the customer maps to >1 JT job and you haven't picked yet.
  const ambiguousLink = (jobRaw: string): ProjectLink | null => {
    if ((jobIdMap[jobRaw] ?? "").trim()) return null; // already picked
    const link = projectsLink(jobRaw);
    return link && link.ids.length > 1 ? link : null;
  };

  const effectiveId = (jobRaw: string) => (jobIdMap[jobRaw] ?? "").trim() || projectsId(jobRaw);
  const idSource = (jobRaw: string): "manual" | "projects" | "" =>
    (jobIdMap[jobRaw] ?? "").trim() ? "manual" : projectsId(jobRaw) ? "projects" : "";

  // A row's JT Cost Item ID: its CSI looked up in ITS OWN job's budget.
  const costItemIdFor = (e: Entry) => {
    const jid = effectiveId(e.jobRaw);
    if (!jid) return "";
    const byCode = budgets[jid];
    return byCode ? matchCostItem(byCode, e.serviceItem) : "";
  };

  // The JT Job IDs we need budgets for (the selected, mapped jobs).
  const neededJobIds = useMemo(() => {
    const s = new Set<string>();
    for (const j of selJobs) {
      const id = effectiveId(j);
      if (id) s.add(id);
    }
    return [...s].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selJobs, jobIdMap, projectsMap, jobInfo]);

  // Fetch each job's cost-code → costItemId map. Jobs that fail are recorded as
  // {} so we mark them attempted and don't spin re-fetching them.
  useEffect(() => {
    const missing = neededJobIds.filter((id) => !(id in budgets));
    if (missing.length === 0) return;
    setBudgetsLoading(true);
    setBudgetsErr("");
    fetch(`/api/job-budget?jobIds=${encodeURIComponent(missing.join(","))}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Failed to load job budgets");
        return j as {
          budgets: Record<string, Record<string, string>>;
          errors?: Record<string, string>;
        };
      })
      .then((j) => {
        const merged: Record<string, Record<string, string>> = { ...j.budgets };
        for (const id of Object.keys(j.errors ?? {})) merged[id] = {}; // attempted
        setBudgets((prev) => ({ ...prev, ...merged }));
        const firstErr = Object.values(j.errors ?? {})[0];
        if (firstErr) setBudgetsErr(firstErr);
      })
      .catch((e) => {
        setBudgetsErr(e instanceof Error ? e.message : "Could not load job budgets");
        setBudgets((prev) => {
          const next = { ...prev };
          for (const id of missing) if (!(id in next)) next[id] = {};
          return next;
        });
      })
      .finally(() => setBudgetsLoading(false));
  }, [neededJobIds, budgets]);

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

  // Export-ready: the row resolves to a JT user, a JT job, a cost item in that
  // job's budget, AND a pay type. JobTread requires all four.
  const ready = useMemo(
    () =>
      selected.filter(
        (e) => userIdFor(e.worker) && effectiveId(e.jobRaw) && costItemIdFor(e) && typeFor(e),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, jobIdMap, projectsMap, jobInfo, budgets, workerIdMap, typeMap, jtUsers, orgTypes],
  );

  // (worker × job) pairs in play, and those still missing a pay type.
  const typePairs = useMemo(() => {
    const m = new Map<string, { worker: string; jobRaw: string }>();
    for (const e of selected) {
      if (!m.has(typeKey(e.worker, e.jobRaw))) {
        m.set(typeKey(e.worker, e.jobRaw), { worker: e.worker, jobRaw: e.jobRaw });
      }
    }
    return [...m.values()].sort(
      (a, b) => a.worker.localeCompare(b.worker) || a.jobRaw.localeCompare(b.jobRaw),
    );
  }, [selected]);

  const typesNeeded = useMemo(
    () => typePairs.filter((p) => !typeFor({ worker: p.worker, jobRaw: p.jobRaw } as Entry)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typePairs, typeMap, workerIdMap, jtUsers, orgTypes],
  );

  // Mapped to a job, but the CSI isn't a cost item in that job's budget.
  const noCostItem = useMemo(
    () => selected.filter((e) => effectiveId(e.jobRaw) && !costItemIdFor(e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, jobIdMap, projectsMap, jobInfo, budgets],
  );

  // Distinct workers in the file, and those still missing a JT user.
  const workersNeedingId = useMemo(
    () =>
      [...new Set(selected.map((e) => e.worker).filter(Boolean))]
        .filter((w) => !(workerIdMap[w] ?? "").trim())
        .sort(),
    [selected, workerIdMap],
  );

  // Jobs currently in the filter that still have no JT Job ID.
  const jobsNeedingId = useMemo(
    () => [...selJobs].filter((j) => !effectiveId(j)).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selJobs, jobIdMap, projectsMap, jobInfo],
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
    download(
      `${base} - JT import.csv`,
      buildCsv(ready, (e) => ({
        userId: userIdFor(e.worker),
        userName: userNameFor(e.worker),
        jobId: effectiveId(e.jobRaw),
        costItemId: costItemIdFor(e),
        type: typeFor(e),
      })),
    );
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
                {ready.length} ready · {selected.length - ready.length} held back (needs a user, job,
                or cost item) · {dropped.length} dropped · {entries.length} total
                {budgetsLoading && " · loading job budgets…"}
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
                  muted={internalJobs.has(job)}
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

          {/* Worker → JobTread user */}
          <div className="mb-5 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 text-sm font-semibold">
              JobTread users
              {workersNeedingId.length > 0 && (
                <span className="ml-2 font-normal text-amber-600 dark:text-amber-400">
                  {workersNeedingId.length} unmapped — those rows are held back
                </span>
              )}
            </div>
            <p className="mb-3 text-xs text-neutral-500">
              JobTread matches a worker on its own display name — usually a first name
              (&quot;Cedar&quot;), but not always (&quot;Ty O&apos;Steen&quot;). So we send the{" "}
              <b>User ID</b> read from JobTread rather than guessing a name. Exact name matches
              auto-fill; anyone else (Tyler → Ty, Thomas → Tommy) you pick once.
              {usersError && (
                <span className="block text-amber-600 dark:text-amber-400">
                  Couldn&apos;t load JobTread users ({usersError}).
                </span>
              )}
            </p>
            <div className="space-y-2">
              {[...new Set(selected.map((e) => e.worker).filter(Boolean))].sort().map((w) => (
                <div key={w} className="flex items-center gap-2">
                  <span className="w-48 shrink-0 truncate text-sm" title={w}>
                    {w}
                  </span>
                  <select
                    value={workerIdMap[w] ?? ""}
                    onChange={(e) => setWorkerId(w, e.target.value)}
                    className="flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-accent dark:border-neutral-700"
                  >
                    <option value="">— pick JobTread user —</option>
                    {(jtUsers ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {(u.isInternal ? "★ " : "") + u.name}
                      </option>
                    ))}
                  </select>
                  <span
                    className={
                      "w-24 shrink-0 whitespace-nowrap text-right text-xs " +
                      (userIdFor(w) ? "text-accent" : "text-amber-500")
                    }
                  >
                    {userIdFor(w) ? `✓ ${userNameFor(w)}` : "unmapped"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Job ID mapping — only for jobs currently selected */}
          {[...selJobs].length > 0 && (
            <div className="mb-5 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  JobTread Job IDs
                  {jobsNeedingId.length > 0 && (
                    <span className="ml-2 font-normal text-amber-600 dark:text-amber-400">
                      {jobsNeedingId.length} unmapped — those rows are held back
                    </span>
                  )}
                </div>
                <label className="cursor-pointer whitespace-nowrap text-xs font-semibold text-accent">
                  {projectsMeta ? "Replace Projects map" : "Load Projects map (CSV)"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadProjectsFile(f);
                    }}
                  />
                </label>
              </div>
              <p className="mb-3 text-xs text-neutral-500">
                JobTread rejects QB job names, so we emit the Job ID. IDs auto-fill from the Project
                Database <b>Projects</b> tab (<code>jobcode_1</code> → <code>JobTread Job ID</code>) —
                export that tab as CSV and load it.{" "}
                {projectsMeta ? (
                  <span className="text-accent">
                    {projectsMeta.count} links loaded from {projectsMeta.name}.
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">None loaded yet.</span>
                )}{" "}
                That tab is <b>customer-level</b>, so a customer with several JobTread jobs (Moon
                Spring Farm → Pole Barn + Main House; Velorum → 3 jobs) resolves to more than one
                job. Those are <b>never auto-filled</b> — they say <b>pick a job</b> and list the
                candidates, so you choose once instead of us silently stamping the wrong job&apos;s
                budget. The dropdown floats that customer&apos;s jobs (★) to the top. Picks are
                remembered on this device.
                {projectsErr && (
                  <span className="block text-red-600 dark:text-red-400">{projectsErr}</span>
                )}
              </p>
              <div className="space-y-2">
                {[...selJobs].sort().map((job) => {
                  const src = idSource(job);
                  const amb = ambiguousLink(job);
                  return (
                    <div key={job} className="flex items-center gap-2">
                      <span className="w-48 shrink-0 truncate text-sm" title={job}>
                        {job || "(blank)"}
                        {amb && (
                          <span
                            className="block truncate text-xs text-amber-600 dark:text-amber-400"
                            title={amb.labels.join(" · ")}
                          >
                            {amb.ids.length} JT jobs: {amb.labels.join(" · ")}
                          </span>
                        )}
                      </span>
                      <JobIdControl
                        job={job}
                        customer={jobInfo.get(job)?.job1 ?? ""}
                        jtJobs={jtJobs}
                        value={effectiveId(job)}
                        manual={manualJobs.has(job)}
                        onSet={(v) => setJobId(job, v)}
                        onManual={(on) => setManual(job, on)}
                      />
                      <span
                        className={
                          "w-24 shrink-0 whitespace-nowrap text-right text-xs " +
                          (src ? "text-accent" : "text-amber-500")
                        }
                      >
                        {src === "projects"
                          ? "✓ Projects"
                          : src === "manual"
                            ? "✓ manual"
                            : amb
                              ? "pick a job"
                              : "unmapped"}
                      </span>
                    </div>
                  );
                })}
              </div>
              {(jobsLoading || jobsError) && (
                <p className="mt-2 text-xs text-neutral-500">
                  {jobsLoading && "Loading JobTread jobs for the picker…"}
                  {jobsError && (
                    <span className="text-amber-600 dark:text-amber-400">
                      JobTread job picker unavailable ({jobsError}) — type IDs or load the Projects map.
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Pay type — per worker AND per job */}
          {typePairs.length > 0 && (
            <div className="mb-5 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-2 text-sm font-semibold">
                Pay type
                {typesNeeded.length > 0 && (
                  <span className="ml-2 font-normal text-amber-600 dark:text-amber-400">
                    {typesNeeded.length} unset — those rows are held back
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-neutral-500">
                JobTread requires a <code>Type</code> on every time entry, and it&apos;s a{" "}
                <b>pay rate</b>: each person has their own set, scoped per job (different rates on
                different jobs) — so &quot;Regular Pay&quot; isn&apos;t even an option for everyone.
                Nothing is assumed: pick one per worker × job (auto-set only when someone has a
                single option). Remembered on this device.
                {jtUsers && !jtUsers.some((u) => u.types) && (
                  <span className="block text-amber-600 dark:text-amber-400">
                    Showing all {orgTypes.length} org pay types — the JT grant can&apos;t read each
                    member&apos;s own set (needs the <code>createTimeEntryForMembership</code> action),
                    so pick carefully.
                  </span>
                )}
              </p>
              <div className="space-y-2">
                {typePairs.map((p) => {
                  const opts = typeOptionsFor(p.worker);
                  const cur = typeFor({ worker: p.worker, jobRaw: p.jobRaw } as Entry);
                  const mapped = !!userIdFor(p.worker);
                  return (
                    <div key={typeKey(p.worker, p.jobRaw)} className="flex items-center gap-2">
                      <span
                        className="w-48 shrink-0 truncate text-sm"
                        title={`${p.worker} · ${p.jobRaw}`}
                      >
                        {p.worker}
                        <span className="block truncate text-xs text-neutral-400">{p.jobRaw}</span>
                      </span>
                      <select
                        value={typeMap[typeKey(p.worker, p.jobRaw)] ?? cur ?? ""}
                        onChange={(e) => setType(p.worker, p.jobRaw, e.target.value)}
                        className="flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-accent dark:border-neutral-700"
                      >
                        <option value="">
                          {mapped ? "— pick a pay type —" : "— map this worker first —"}
                        </option>
                        {opts.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name +
                              (typeof t.hourlyRate === "number" ? ` ($${t.hourlyRate}/hr)` : "")}
                          </option>
                        ))}
                      </select>
                      <span
                        className={
                          "w-24 shrink-0 whitespace-nowrap text-right text-xs " +
                          (cur ? "text-accent" : "text-amber-500")
                        }
                      >
                        {cur ? "✓ set" : "unset"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CSI codes that aren't a cost item in that job's JobTread budget */}
          {noCostItem.length > 0 && (
            <details className="mb-5 rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
              <summary className="cursor-pointer font-medium text-neutral-600 dark:text-neutral-300">
                {noCostItem.length} row{noCostItem.length === 1 ? "" : "s"} held back — cost code not
                in that job&apos;s JobTread budget
              </summary>
              <p className="mt-2 text-xs text-neutral-500">
                JobTread requires a cost item on every time entry, and cost items are per-job. Add
                the code to that job&apos;s budget in JobTread (then reload this page), or fix the
                service item in the labor report.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-neutral-500">
                {[
                  ...new Set(noCostItem.map((e) => `${e.serviceItem || "(blank)"} @ ${e.jobRaw}`)),
                ]
                  .slice(0, 50)
                  .map((s) => (
                    <li key={s}>
                      <span className="text-amber-600 dark:text-amber-400">{s}</span>
                    </li>
                  ))}
              </ul>
              {budgetsErr && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{budgetsErr}</p>
              )}
            </details>
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
                    <td className="px-2 py-1 whitespace-nowrap font-mono">{userIdFor(e.worker)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{userNameFor(e.worker)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{e.start}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{e.end}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono">{effectiveId(e.jobRaw)}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono">
                      {costItemIdFor(e)}
                      <span className="ml-1 font-sans text-neutral-400">{e.serviceItem}</span>
                    </td>
                    <td className="max-w-[16rem] truncate px-2 py-1" title={e.notes}>
                      {e.notes}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{typeFor(e)}</td>
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
  customer,
  jtJobs,
  value,
  manual,
  onSet,
  onManual,
}: {
  job: string;
  customer: string;
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
    // Float this customer's JobTread jobs to the top — for a multi-job customer
    // that's the short list you actually need to choose between.
    const ck = keyOf(customer);
    const sorted = ck
      ? [...jtJobs].sort(
          (a, b) =>
            (keyOf(a.customer ?? "") === ck ? 0 : 1) - (keyOf(b.customer ?? "") === ck ? 0 : 1),
        )
      : jtJobs;
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
        {sorted.map((j) => (
          <option key={j.id} value={j.id}>
            {(keyOf(j.customer ?? "") === ck ? "★ " : "") +
              (j.customer ? j.customer + " — " : "") +
              j.name +
              (j.number ? " (#" + j.number + ")" : "")}
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
