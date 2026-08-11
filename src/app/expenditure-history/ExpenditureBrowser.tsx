"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  Chip,
  ChipScroller,
  EmptyState,
  FilterChip,
  Input,
  Loading,
  PageHeader,
  SectionHeading,
  SectionLabel,
  Select,
  StatementBlock,
  Toggle,
} from "@/components/ui";

/**
 * Expenditure History — the whole Expenditure sheet, searchable on a phone.
 *
 * This is the archive, not JobTread. Everything the company billed before the
 * JobTread migration exists only in that spreadsheet, and since AppSheet was
 * retired there was no way to look at it. The data comes from
 * /api/expenditure-history → the Apps Script action `listExpenditureHistory`
 * (ascent-appscript/ExpenditureHistory.js); nothing on this page writes.
 *
 * ## Shape
 *
 * Search and grouping run over the WHOLE archive in the browser, so the whole
 * archive has to get here — which it does as positional arrays (not objects
 * with fifteen repeated keys) fetched in pages until the server says `done`.
 * Rows render as each page lands rather than after the last one, so the first
 * jobs are browsable while the tail is still coming. `ROW` below pins the
 * positions and MUST stay in step with `EXP_HISTORY_COLUMNS` in the Apps Script
 * file.
 *
 * ## The hierarchy
 *
 * Job → billing month → vendor → bill → its line items and its scanned PDF.
 * Grouping by vendor inside a month is what collapses Sunset — which bills as
 * dozens of small invoices a month — into a single row, instead of burying
 * every other vendor on the job under it.
 *
 * A vendor with exactly one bill in the month renders AS that bill rather than
 * as a group wrapping it: the grouping exists to fold up repetition, and making
 * someone open a group to find the single row it holds is a tap that buys them
 * nothing.
 */

/* --------------------------------------------------------------- wire types */

/** Positional row layout — mirrors EXP_HISTORY_COLUMNS in ExpenditureHistory.js. */
const ROW = {
  expId: 0,
  projectId: 1,
  vendorId: 2,
  billYear: 3,
  billMonth: 4,
  date: 5,
  amount: 6,
  tax: 7,
  csi: 8,
  status: 9,
  type: 10,
  invoiceId: 11,
  fileId: 12,
  inJt: 13,
} as const;

type WireRow = (string | number)[];

interface JobRef {
  id: string;
  label: string;
  customer: string;
  project: string;
}
interface VendorRef {
  id: string;
  name: string;
}
interface HistoryPayload {
  ok?: boolean;
  error?: string;
  generatedAt?: string;
  jobs?: JobRef[];
  vendors?: VendorRef[];
  rows?: WireRow[];
  /** Sheet rows consumed by this page — what the next offset advances by. */
  scanned?: number;
  total?: number;
  done?: boolean;
}
interface LineItem {
  id: string;
  desc: string;
  csi: string;
  qty: number;
  price: number;
  amount: number;
  source: string;
  invoiceNumber?: string;
  date?: string;
}

/* ------------------------------------------------------------ decoded model */

interface Bill {
  expId: string;
  jobId: string;
  jobLabel: string;
  vendorId: string;
  vendorName: string;
  year: number;
  month: number;
  date: string;
  amount: number;
  tax: number;
  csi: string;
  status: string;
  type: string;
  invoiceId: string;
  fileId: string;
  inJt: boolean;
  /** Pre-lowercased haystack — search runs over thousands of rows per keystroke. */
  hay: string;
}

interface VendorGroup {
  key: string;
  name: string;
  total: number;
  bills: Bill[];
}
interface MonthGroup {
  key: string;
  label: string;
  total: number;
  count: number;
  vendors: VendorGroup[];
}
interface JobGroup {
  key: string;
  label: string;
  total: number;
  count: number;
  months: MonthGroup[];
}

/* ------------------------------------------------------------------ helpers */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const money = (n: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Compact form for group headers, where the cents are noise. */
const moneyShort = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");

const NO_PERIOD = "No billing period";
const NO_JOB = "No job";
const NO_VENDOR = "No vendor";

function periodLabel(year: number, month: number): string {
  if (!year && !month) return NO_PERIOD;
  if (!month) return String(year);
  return `${MONTHS[month - 1]}${year ? " " + year : ""}`;
}

function dateLabel(d: string): string {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Drive renders page 1 of a PDF as an image at this endpoint — same trick the
 *  Tools page uses for tool photos. Only works for a viewer signed into an
 *  account with access, which every Assistant user is. */
const thumbUrl = (fileId: string) => `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
const driveUrl = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

const STATUS_TONE = (status: string) => {
  const s = status.toLowerCase();
  if (s.includes("fail") || s.includes("unmatched") || s.includes("deleted")) return "danger" as const;
  if (s.includes("review") || s.includes("ready")) return "warning" as const;
  if (s.includes("sent") || s.includes("pushed")) return "success" as const;
  return "neutral" as const;
};

/* ------------------------------------------------------------------- decode */

function decode(
  rows: WireRow[],
  jobsById: Map<string, JobRef>,
  vendorsById: Map<string, VendorRef>,
): Bill[] {
  return rows.map((r) => {
    // A raw cell with no dictionary entry still renders — labelled with itself.
    // Old rows carry an unmatched vendor NAME where newer ones carry a VendorID,
    // and a project the Projects tab has since lost is still a real bill.
    const projectId = String(r[ROW.projectId] ?? "");
    const vendorId = String(r[ROW.vendorId] ?? "");
    const j = jobsById.get(projectId);
    const v = vendorsById.get(vendorId);
    const year = Number(r[ROW.billYear]) || 0;
    const month = Number(r[ROW.billMonth]) || 0;
    const bill: Bill = {
      expId: String(r[ROW.expId] ?? ""),
      jobId: projectId,
      jobLabel: j?.label ?? (projectId || NO_JOB),
      vendorId,
      vendorName: v?.name ?? (vendorId || NO_VENDOR),
      year,
      month,
      date: String(r[ROW.date] ?? ""),
      amount: Number(r[ROW.amount]) || 0,
      tax: Number(r[ROW.tax]) || 0,
      csi: String(r[ROW.csi] ?? ""),
      status: String(r[ROW.status] ?? ""),
      type: String(r[ROW.type] ?? ""),
      invoiceId: String(r[ROW.invoiceId] ?? ""),
      fileId: String(r[ROW.fileId] ?? ""),
      inJt: Number(r[ROW.inJt]) === 1,
      hay: "",
    };
    // Everything a search could reasonably mean, joined once at load rather
    // than rebuilt per keystroke across the whole archive.
    bill.hay = [
      bill.expId, bill.invoiceId, bill.vendorName, bill.vendorId, bill.jobLabel,
      bill.csi, bill.status, bill.type, bill.date,
      periodLabel(year, month), bill.amount.toFixed(2),
    ]
      .join(" ")
      .toLowerCase();
    return bill;
  });
}

/* ------------------------------------------------------------------ grouping */

function group(bills: Bill[]): JobGroup[] {
  const jobs = new Map<string, JobGroup>();

  for (const b of bills) {
    const jobKey = b.jobId || NO_JOB;
    let job = jobs.get(jobKey);
    if (!job) {
      job = { key: jobKey, label: b.jobLabel, total: 0, count: 0, months: [] };
      jobs.set(jobKey, job);
    }
    job.total += b.amount;
    job.count += 1;

    const monthKey = `${jobKey}|${b.year}-${b.month}`;
    let month = job.months.find((m) => m.key === monthKey);
    if (!month) {
      month = { key: monthKey, label: periodLabel(b.year, b.month), total: 0, count: 0, vendors: [] };
      job.months.push(month);
    }
    month.total += b.amount;
    month.count += 1;

    const vendorKey = `${monthKey}|${b.vendorId || NO_VENDOR}`;
    let vendor = month.vendors.find((v) => v.key === vendorKey);
    if (!vendor) {
      vendor = { key: vendorKey, name: b.vendorName, total: 0, bills: [] };
      month.vendors.push(vendor);
    }
    vendor.total += b.amount;
    vendor.bills.push(b);
  }

  const out = [...jobs.values()];
  // Jobs alphabetically (the archive is browsed by "which job was that"), months
  // newest first, vendors by spend so the month's biggest line leads.
  out.sort((a, b) => a.label.localeCompare(b.label));
  for (const job of out) {
    job.months.sort((a, b) => {
      const [ay, am] = a.key.split("|")[1].split("-").map(Number);
      const [by, bm] = b.key.split("|")[1].split("-").map(Number);
      return by - ay || bm - am;
    });
    for (const month of job.months) {
      month.vendors.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
      for (const v of month.vendors) {
        v.bills.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------- pieces */

/** A disclosure row: chevron, title, and a right-hand count + total. */
function GroupRow({
  open,
  onClick,
  title,
  sub,
  total,
  count,
  depth,
}: {
  open: boolean;
  onClick: () => void;
  title: string;
  sub?: string;
  total: number;
  count: number;
  depth: 0 | 1 | 2;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`flex min-h-[52px] w-full items-center gap-2.5 border-b border-line-soft py-2 pr-3 text-left transition last:border-b-0 hover:bg-accent/5 dark:hover:bg-white/5 ${
        depth === 0 ? "pl-3" : depth === 1 ? "pl-6" : "pl-9"
      }`}
    >
      <span
        aria-hidden
        className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
          open ? "rotate-90" : ""
        }`}
      >
        ›
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate tracking-tight ${
            depth === 0 ? "text-sm font-semibold" : depth === 1 ? "text-[13px] font-semibold" : "text-[13px]"
          }`}
        >
          {title}
        </span>
        {sub && (
          <span className="mt-0.5 block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {sub}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-semibold tabular-nums">{moneyShort(total)}</span>
        <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
          {count} bill{count === 1 ? "" : "s"}
        </span>
      </span>
    </button>
  );
}

/** The scanned bill. Falls back to a plain Drive link when the thumbnail can't
 *  be rendered (no file, or a viewer without access to it). */
function BillImage({ fileId }: { fileId: string }) {
  const [failed, setFailed] = useState(false);

  if (!fileId) {
    return <p className="text-[11.5px] text-neutral-500">No file on this row.</p>;
  }
  return (
    <div className="space-y-1.5">
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl(fileId)}
          alt="Scanned bill"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full rounded-lg border border-line bg-white"
        />
      )}
      {failed && (
        <p className="text-[11.5px] text-neutral-500">
          Couldn&apos;t render a preview — open it in Drive instead.
        </p>
      )}
      <a
        href={driveUrl(fileId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-[12px] font-semibold text-accent hover:underline"
      >
        Open the PDF in Drive ↗
      </a>
    </div>
  );
}

/** One bill: the summary row, and — once opened — its lines and its scan. */
function BillRow({
  bill,
  open,
  onToggle,
  lines,
  linesLoading,
  linesError,
  depth,
}: {
  bill: Bill;
  open: boolean;
  onToggle: () => void;
  lines: LineItem[] | null;
  linesLoading: boolean;
  linesError: string;
  depth: 2 | 3;
}) {
  const title = bill.invoiceId && bill.invoiceId !== bill.expId ? bill.invoiceId : bill.expId;
  const subParts = [dateLabel(bill.date), bill.csi].filter(Boolean);

  return (
    <div className="border-b border-line-soft last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex min-h-[52px] w-full items-center gap-2.5 py-2 pr-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5 ${
          depth === 2 ? "pl-9" : "pl-12"
        }`}
      >
        <span
          aria-hidden
          className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
            open ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] tracking-tight">
            {depth === 3 ? title : `${bill.vendorName} · ${title}`}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            {subParts.join(" · ")}
            {bill.type && bill.type !== "Invoice" && <Chip tone="info">{bill.type}</Chip>}
            {bill.status && <Chip tone={STATUS_TONE(bill.status)}>{bill.status}</Chip>}
            {bill.inJt && <Chip tone="accent">In JT</Chip>}
          </span>
        </span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums">{money(bill.amount)}</span>
      </button>

      {open && (
        <div className={`space-y-3 pb-4 pr-3 pt-1 ${depth === 2 ? "pl-9" : "pl-12"}`}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
            <Detail label="Bill" value={bill.expId} />
            <Detail label="Invoice #" value={bill.invoiceId || "—"} />
            <Detail label="Vendor" value={bill.vendorName} />
            <Detail label="Job" value={bill.jobLabel} />
            <Detail label="Received" value={dateLabel(bill.date) || "—"} />
            <Detail label="Tax" value={bill.tax ? money(bill.tax) : "—"} />
          </div>

          <div>
            <SectionLabel className="mb-1">Line items</SectionLabel>
            {linesLoading && <Loading label="Loading line items…" />}
            {linesError && <p className="text-[11.5px] text-red-600">{linesError}</p>}
            {!linesLoading && !linesError && (!lines || lines.length === 0) && (
              <p className="text-[11.5px] text-neutral-500">
                No line items were recorded for this bill.
              </p>
            )}
            {!linesLoading && lines && lines.length > 0 && (
              <ul className="divide-y divide-line-soft rounded-lg border border-line">
                {lines.map((l, i) => (
                  <li key={l.id || i} className="flex items-start gap-2 px-2.5 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] leading-snug">
                        {l.desc || l.invoiceNumber || "(no description)"}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-neutral-400">
                        {[
                          l.csi,
                          l.qty ? `${l.qty} × ${money(l.price)}` : "",
                          l.date ? dateLabel(l.date) : "",
                          l.source,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums">
                      {money(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionLabel className="mb-1">Bill</SectionLabel>
            <BillImage fileId={bill.fileId} />
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span className="block truncate">{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

/** Batch ceiling for one line-item request — matches EXP_LINES_MAX_KEYS. */
const MAX_LINE_KEYS = 400;

export default function ExpenditureBrowser() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [loading, setLoading] = useState(true);
  /** Sheet rows still to come, so a partial archive says so instead of looking whole. */
  const [remaining, setRemaining] = useState(0);
  const [loadError, setLoadError] = useState("");

  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [notInJt, setNotInJt] = useState(false);

  const [openJobs, setOpenJobs] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openVendors, setOpenVendors] = useState<Set<string>>(new Set());
  const [openBills, setOpenBills] = useState<Set<string>>(new Set());

  const [linesByKey, setLinesByKey] = useState<Record<string, LineItem[]>>({});
  const [fetchedKeys, setFetchedKeys] = useState<Set<string>>(new Set());
  const [linesBusy, setLinesBusy] = useState<Set<string>>(new Set());
  const [linesError, setLinesError] = useState<Record<string, string>>({});

  /**
   * Pull the archive a page at a time, appending as each lands.
   *
   * `run` is the generation token: a Reload while a load is in flight bumps it,
   * and the stale loop drops its results instead of interleaving them with the
   * fresh ones. The loop also stops on `scanned === 0`, which no correct server
   * response produces before `done` — a belt against spinning forever on one.
   */
  const runRef = useRef(0);
  const load = useCallback(async (fresh: boolean) => {
    const run = ++runRef.current;
    setLoading(true);
    setLoadError("");
    setBills([]);
    setRemaining(0);

    let offset = 0;
    try {
      for (;;) {
        const res = await fetch(
          `/api/expenditure-history?offset=${offset}${fresh ? "&refresh=1" : ""}`,
        );
        const j = (await res.json()) as HistoryPayload;
        if (runRef.current !== run) return; // superseded by a newer load
        if (j.error) {
          setLoadError(String(j.error));
          return;
        }

        const jobsById = new Map((j.jobs ?? []).map((x) => [x.id, x]));
        const vendorsById = new Map((j.vendors ?? []).map((x) => [x.id, x]));
        const page = decode(j.rows ?? [], jobsById, vendorsById);
        setBills((prev) => [...prev, ...page]);
        setGeneratedAt(j.generatedAt ?? "");

        const scanned = Number(j.scanned) || 0;
        offset += scanned;
        setRemaining(Math.max(0, (Number(j.total) || 0) - offset));
        if (j.done === true || scanned === 0) return;
      }
    } catch (e) {
      if (runRef.current !== run) return;
      setLoadError(e instanceof Error ? e.message : "Network error");
    } finally {
      if (runRef.current === run) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const b of bills) if (b.year) set.add(b.year);
    return [...set].sort((a, b) => b - a);
  }, [bills]);

  // Filter options come from the BILLS, not from the Projects/Vendors tabs the
  // dictionaries were built from: those list every job and vendor the company
  // has ever had, and an option that can only ever return nothing is noise.
  const jobOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of bills) if (b.jobId && !seen.has(b.jobId)) seen.set(b.jobId, b.jobLabel);
    return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [bills]);

  const vendorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of bills) if (b.vendorId && !seen.has(b.vendorId)) seen.set(b.vendorId, b.vendorName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [bills]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const terms = needle ? needle.split(/\s+/) : [];
    return bills.filter((b) => {
      if (year !== "all" && String(b.year) !== year) return false;
      if (jobFilter !== "all" && b.jobId !== jobFilter) return false;
      if (vendorFilter !== "all" && b.vendorId !== vendorFilter) return false;
      if (notInJt && b.inJt) return false;
      // Every word must appear somewhere, so "sunset 2023" narrows rather than widens.
      for (const t of terms) if (!b.hay.includes(t)) return false;
      return true;
    });
  }, [bills, q, year, jobFilter, vendorFilter, notInJt]);

  const grouped = useMemo(() => group(filtered), [filtered]);
  const total = useMemo(() => filtered.reduce((s, b) => s + b.amount, 0), [filtered]);

  const filtersOn =
    q.trim() !== "" || year !== "all" || jobFilter !== "all" || vendorFilter !== "all" || notInJt;

  // A narrow result is a result you want to SEE, not one you want to go on
  // tapping open — so once the filters have cut it down, open the tree for them.
  useEffect(() => {
    if (!filtersOn || grouped.length === 0 || grouped.length > 4) return;
    setOpenJobs(new Set(grouped.map((j) => j.key)));
    setOpenMonths(new Set(grouped.flatMap((j) => j.months.map((m) => m.key))));
  }, [filtersOn, grouped]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  /**
   * Fetch the line items for a bill, taking its whole month group along for the
   * ride. Each request re-reads the child tabs top to bottom on the Apps Script
   * side, so asking for fifty bills costs what asking for one costs — and the
   * next bill the owner opens in that month is then instant.
   */
  const loadLines = useCallback(
    (focus: Bill, siblings: Bill[]) => {
      const keysFor = (b: Bill) =>
        b.invoiceId && b.invoiceId !== b.expId ? [b.expId, b.invoiceId] : [b.expId];

      // The focused bill first, so it survives the cap on a very large month.
      const ordered = [focus, ...siblings.filter((b) => b.expId !== focus.expId)];
      const wanted: string[] = [];
      for (const b of ordered) {
        for (const k of keysFor(b)) {
          if (!fetchedKeys.has(k) && !wanted.includes(k) && wanted.length < MAX_LINE_KEYS) {
            wanted.push(k);
          }
        }
      }
      if (wanted.length === 0) return;

      setLinesBusy((s) => new Set([...s, ...wanted]));
      fetch("/api/expenditure-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: wanted }),
      })
        .then((r) => r.json())
        .then((j: { error?: string; lines?: Record<string, LineItem[]> }) => {
          if (j.error) {
            setLinesError((e) => {
              const next = { ...e };
              for (const k of wanted) next[k] = String(j.error);
              return next;
            });
            return;
          }
          setLinesByKey((m) => ({ ...m, ...(j.lines ?? {}) }));
          // Mark every key asked for, not just the ones that came back: a key
          // with no lines has none, and must not re-fetch on every open.
          setFetchedKeys((s) => new Set([...s, ...wanted]));
          // Clear anything left over from a failed earlier attempt, or the row
          // would keep showing the old error under its freshly loaded lines.
          setLinesError((e) => {
            const next = { ...e };
            for (const k of wanted) delete next[k];
            return next;
          });
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : "Network error";
          setLinesError((prev) => {
            const next = { ...prev };
            for (const k of wanted) next[k] = msg;
            return next;
          });
        })
        .finally(() => {
          setLinesBusy((s) => {
            const next = new Set(s);
            for (const k of wanted) next.delete(k);
            return next;
          });
        });
    },
    [fetchedKeys],
  );

  function toggleBill(bill: Bill, siblings: Bill[]) {
    setOpenBills((s) => toggle(s, bill.expId));
    if (!openBills.has(bill.expId)) loadLines(bill, siblings);
  }

  /** A bill's lines, merged across whichever key the child tab happened to use. */
  function linesFor(bill: Bill): LineItem[] | null {
    const keys = bill.invoiceId && bill.invoiceId !== bill.expId
      ? [bill.expId, bill.invoiceId]
      : [bill.expId];
    if (!keys.some((k) => fetchedKeys.has(k))) return null;
    const seen = new Set<string>();
    const out: LineItem[] = [];
    for (const k of keys) {
      for (const l of linesByKey[k] ?? []) {
        const id = l.id || `${k}:${out.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(l);
      }
    }
    return out;
  }

  const billState = (bill: Bill) => {
    const keys = bill.invoiceId && bill.invoiceId !== bill.expId
      ? [bill.expId, bill.invoiceId]
      : [bill.expId];
    return {
      busy: keys.some((k) => linesBusy.has(k)),
      error: keys.map((k) => linesError[k]).find(Boolean) ?? "",
    };
  };

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Expenditure History"
        description="Every bill in the Expenditure sheet, including the years before JobTread."
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={loading}>
            Reload
          </Button>
        }
      />

      {loadError && (
        <Banner tone="error" className="mb-4">
          {loadError}
        </Banner>
      )}

      {loading && bills.length === 0 && <Loading label="Loading the archive…" />}
      {loading && bills.length > 0 && (
        // Say the list is still filling, or a search run mid-load looks like it
        // simply found nothing in the rows that haven't arrived yet.
        <div className="mb-3">
          <Loading
            label={`Still loading${remaining > 0 ? ` — ${remaining.toLocaleString()} more rows` : ""}…`}
          />
        </div>
      )}

      {bills.length > 0 && (
        <>
          <StatementBlock
            label={filtersOn ? "Matching" : "Archive total"}
            value={moneyShort(total)}
            sub={`${filtered.length.toLocaleString()} bill${filtered.length === 1 ? "" : "s"} · ${grouped.length} job${grouped.length === 1 ? "" : "s"}${
              filtersOn ? ` of ${bills.length.toLocaleString()}` : ""
            }`}
            footnote={
              generatedAt
                ? `Read from the Expenditure sheet at ${generatedAt}. This is the sheet's own record — not JobTread.`
                : undefined
            }
          />

          <div className="mt-5 space-y-2.5">
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search job, vendor, invoice #, CSI, amount…"
              aria-label="Search the archive"
            />

            <ChipScroller>
              <FilterChip on={year === "all"} onClick={() => setYear("all")}>
                All years
              </FilterChip>
              {years.map((y) => (
                <FilterChip key={y} on={year === String(y)} onClick={() => setYear(String(y))}>
                  {y}
                </FilterChip>
              ))}
            </ChipScroller>

            <div className="grid grid-cols-2 gap-2">
              <Select
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                aria-label="Filter by job"
              >
                <option value="all">All jobs</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </Select>
              <Select
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                aria-label="Filter by vendor"
              >
                <option value="all">All vendors</option>
                {vendorOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Toggle checked={notInJt} onChange={setNotInJt} label="Not in JobTread" />
              {filtersOn && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    setYear("all");
                    setJobFilter("all");
                    setVendorFilter("all");
                    setNotInJt(false);
                  }}
                  className="text-[12px] font-semibold text-accent hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <SectionHeading
              trailing={
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {grouped.length} job{grouped.length === 1 ? "" : "s"}
                </span>
              }
            >
              By job, month, vendor
            </SectionHeading>

            {grouped.length === 0 ? (
              <EmptyState>Nothing matches those filters.</EmptyState>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line bg-white dark:bg-ink-raised">
                {grouped.map((job) => {
                  const jobOpen = openJobs.has(job.key);
                  return (
                    <div key={job.key} className="border-b border-line-soft last:border-b-0">
                      <GroupRow
                        depth={0}
                        open={jobOpen}
                        onClick={() => setOpenJobs((s) => toggle(s, job.key))}
                        title={job.label}
                        sub={`${job.months.length} month${job.months.length === 1 ? "" : "s"}`}
                        total={job.total}
                        count={job.count}
                      />
                      {jobOpen &&
                        job.months.map((month) => {
                          const monthOpen = openMonths.has(month.key);
                          const monthBills = month.vendors.flatMap((v) => v.bills);
                          return (
                            <div key={month.key}>
                              <GroupRow
                                depth={1}
                                open={monthOpen}
                                onClick={() => setOpenMonths((s) => toggle(s, month.key))}
                                title={month.label}
                                sub={`${month.vendors.length} vendor${month.vendors.length === 1 ? "" : "s"}`}
                                total={month.total}
                                count={month.count}
                              />
                              {monthOpen &&
                                month.vendors.map((vendor) => {
                                  // One bill needs no wrapper — see the header note.
                                  if (vendor.bills.length === 1) {
                                    const bill = vendor.bills[0];
                                    const st = billState(bill);
                                    return (
                                      <BillRow
                                        key={vendor.key}
                                        depth={2}
                                        bill={bill}
                                        open={openBills.has(bill.expId)}
                                        onToggle={() => toggleBill(bill, monthBills)}
                                        lines={linesFor(bill)}
                                        linesLoading={st.busy}
                                        linesError={st.error}
                                      />
                                    );
                                  }
                                  const vendorOpen = openVendors.has(vendor.key);
                                  return (
                                    <div key={vendor.key}>
                                      <GroupRow
                                        depth={2}
                                        open={vendorOpen}
                                        onClick={() => setOpenVendors((s) => toggle(s, vendor.key))}
                                        title={vendor.name}
                                        total={vendor.total}
                                        count={vendor.bills.length}
                                      />
                                      {vendorOpen &&
                                        vendor.bills.map((bill) => {
                                          const st = billState(bill);
                                          return (
                                            <BillRow
                                              key={bill.expId}
                                              depth={3}
                                              bill={bill}
                                              open={openBills.has(bill.expId)}
                                              onToggle={() => toggleBill(bill, monthBills)}
                                              lines={linesFor(bill)}
                                              linesLoading={st.busy}
                                              linesError={st.error}
                                            />
                                          );
                                        })}
                                    </div>
                                  );
                                })}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
