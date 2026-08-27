/**
 * Bill search index — the engine behind /bill-search.
 *
 * GOAL: type "2x4" or "Preferred Plumbing" and see every matching bill (and the
 * line that matched) in under a second, across as many records as we have —
 * years of pre-JobTread history included.
 *
 * WHY A LOCAL INDEX. Searching live is impossible inside a second: a bill's line
 * items are a JobTread document's `costItems`, and the Pave API can't be asked
 * "which bills have a line matching 2x4" (a `where` joining on the parent
 * document 400s, and cost items can't nest in a big paged documents sweep — the
 * 413 rule). So we keep a local snapshot in SQLite + an FTS5 index and search
 * THAT. JobTread stays the source of truth; this is a cache.
 *
 * TWO SOURCES, JOINED BY "IS IT IN JOBTREAD?":
 *  - LIVE (source='jobtread') — `reindexFromJobTread()` sweeps every vendorBill
 *    and its lines straight from Pave. Authoritative for everything currently in
 *    JobTread. Rebuilt whole (documents carry no `updatedAt`, so we can't tell
 *    which bills were edited — only a full sweep stays correct).
 *  - HISTORY (source='sheet') — `seedFromSheet()` is a ONE-TIME import of the
 *    pre-JobTread Expenditure/lineItem sheets, and it only takes rows the sheet
 *    marks as NOT in JobTread (`inJt=0`). Those are exactly the records the live
 *    sweep can't reach, so the two sources never fight over the same bill.
 *
 * FRESHNESS. The search route serves instantly from the index and, when the
 * index is older than STALE_AFTER_MS, tells the client to fire a background
 * refresh (Vercel can't run work reliably after a response returns, so the
 * client drives it). A lock keeps concurrent searchers from each sweeping.
 */

import { rawDb, ensureDb } from "@/db";
import type { PaveConfig } from "./jobtread";
import { pave } from "./jobtread";
import { callAppsScriptOrThrow } from "./appsScript";

/** Rebuild the live half of the index once it's older than this (default 1h). */
export const STALE_AFTER_MS = 60 * 60 * 1000;
/** A refresh lock older than this is treated as abandoned and can be re-taken. */
const LOCK_TTL_MS = 15 * 60 * 1000;
/** Max FTS/LIKE rows returned to the UI. */
const SEARCH_LIMIT = 200;
/** JobTread documents page size — SMALL so nested costItems don't 413 (see rule). */
const DOC_PAGE_SIZE = 25;
/** Expenditure rows pulled from the sheet per seed page (the client loops pages). */
const SEED_PAGE_ROWS = 2000;
/** Sheet line-item lookups are batched by bill key (Apps Script caps at 400). */
const SEED_LINE_BATCH = 400;

// ── Types ────────────────────────────────────────────────────────────────────

export interface IndexedLine {
  lineId: string;
  description: string;
  csi: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface IndexedBill {
  source: "jobtread" | "sheet";
  jtDocId: string;
  expId: string;
  vendor: string;
  vendorId: string;
  invoiceId: string;
  billNumber: string;
  amount: number;
  status: string;
  issueDate: string;
  jobId: string;
  jobName: string;
  customer: string;
  csi: string;
  pdfFileId: string;
  isSunset: boolean;
  lines: IndexedLine[];
}

/** One search hit: the bill plus the lines that contain the query. */
export interface BillSearchResult {
  id: number;
  source: "jobtread" | "sheet";
  jtDocId: string;
  expId: string;
  vendor: string;
  invoiceId: string;
  billNumber: string;
  amount: number;
  status: string;
  issueDate: string;
  jobId: string;
  jobName: string;
  customer: string;
  pdfFileId: string;
  isSunset: boolean;
  lines: IndexedLine[];
  matchedLines: IndexedLine[];
}

export interface IndexStatus {
  billCount: number;
  lastRefreshAt: string | null;
  stale: boolean;
  refreshing: boolean;
  seedDone: boolean;
}

// ── Meta / staleness / lock ──────────────────────────────────────────────────

async function getMeta(key: string): Promise<string | null> {
  const r = await rawDb().execute({
    sql: "SELECT value FROM bill_index_meta WHERE key = ?",
    args: [key],
  });
  return (r.rows[0]?.value as string | undefined) ?? null;
}

async function setMeta(key: string, value: string): Promise<void> {
  await rawDb().execute({
    sql: `INSERT INTO bill_index_meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

async function billCount(): Promise<number> {
  const r = await rawDb().execute("SELECT COUNT(*) AS n FROM bill_index");
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Atomically claim the refresh lock. Uses a conditional upserted timestamp so two
 * concurrent callers can't both win: the row is written only when it's absent or
 * its timestamp is already older than the abandonment cutoff. `rowsAffected===1`
 * means we took it.
 */
async function acquireRefreshLock(): Promise<boolean> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const r = await rawDb().execute({
    sql: `INSERT INTO bill_index_meta (key, value) VALUES ('refresh_lock', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
          WHERE bill_index_meta.value < ?`,
    args: [now, cutoff],
  });
  return r.rowsAffected === 1;
}

async function releaseRefreshLock(): Promise<void> {
  await rawDb().execute("DELETE FROM bill_index_meta WHERE key = 'refresh_lock'");
}

async function refreshInFlight(): Promise<boolean> {
  const lock = await getMeta("refresh_lock");
  if (!lock) return false;
  return lock >= new Date(Date.now() - LOCK_TTL_MS).toISOString();
}

export async function getIndexStatus(): Promise<IndexStatus> {
  await ensureDb();
  const [count, lastRefreshAt, seedDone, refreshing] = await Promise.all([
    billCount(),
    getMeta("last_refresh_at"),
    getMeta("seed_done"),
    refreshInFlight(),
  ]);
  const stale =
    !lastRefreshAt || Date.now() - Date.parse(lastRefreshAt) > STALE_AFTER_MS;
  return { billCount: count, lastRefreshAt, stale, refreshing, seedDone: seedDone === "1" };
}

// ── Write helpers (bulk, id-assigned so we avoid a round trip per row) ─────────

/** Escape a value for a single-quoted SQL literal (bulk statements, no params). */
function lit(v: string | number): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  return `'${v.replace(/'/g, "''")}'`;
}

/** The FTS "lines" blob for a bill — every line's name/description + code. */
function linesText(b: IndexedBill): string {
  return b.lines
    .map((l) => `${l.description} ${l.csi}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function nextBillId(): Promise<number> {
  const r = await rawDb().execute("SELECT COALESCE(MAX(id), 0) AS m FROM bill_index");
  return Number(r.rows[0]?.m ?? 0) + 1;
}

/** Does the FTS5 table exist and work? Decides MATCH vs the LIKE fallback. */
let _ftsOk: boolean | null = null;
async function ftsAvailable(): Promise<boolean> {
  if (_ftsOk !== null) return _ftsOk;
  try {
    await rawDb().execute("SELECT 1 FROM bill_fts LIMIT 1");
    _ftsOk = true;
  } catch {
    _ftsOk = false;
  }
  return _ftsOk;
}

/**
 * Replace every row for one source with a fresh set. Deletes the source's bills,
 * their lines, and their FTS rows, then bulk-inserts the new ones with
 * explicitly-assigned ids (so the FTS rowid can match without a per-row round
 * trip). Statements are chunked; each chunk is one transactional batch.
 */
async function replaceSource(source: "jobtread" | "sheet", bills: IndexedBill[]): Promise<void> {
  const hasFts = await ftsAvailable();

  // Clear the old rows for this source (FTS rowids first, while we can still see them).
  if (hasFts) {
    await rawDb().execute({
      sql: `DELETE FROM bill_fts WHERE rowid IN (SELECT id FROM bill_index WHERE source = ?)`,
      args: [source],
    });
  }
  await rawDb().execute({
    sql: `DELETE FROM bill_line_index WHERE bill_id IN (SELECT id FROM bill_index WHERE source = ?)`,
    args: [source],
  });
  await rawDb().execute({ sql: `DELETE FROM bill_index WHERE source = ?`, args: [source] });

  await bulkInsert(bills, await nextBillId(), hasFts);
}

/**
 * Append bills to the index starting at `startId`, chunked into transactional
 * batches. Shared by the whole-source rebuild and the paged seed (which appends
 * page by page after clearing the source once, on its first page).
 */
async function bulkInsert(bills: IndexedBill[], startId: number, hasFts: boolean): Promise<void> {
  const stmts: string[] = [];
  let id = startId;
  const now = new Date().toISOString();

  for (const b of bills) {
    stmts.push(
      `INSERT INTO bill_index
         (id, source, jt_doc_id, exp_id, vendor, vendor_id, invoice_id, bill_number,
          amount, status, issue_date, job_id, job_name, customer, csi, pdf_file_id, is_sunset, updated_at)
       VALUES (${lit(id)}, ${lit(b.source)}, ${lit(b.jtDocId)}, ${lit(b.expId)}, ${lit(b.vendor)},
          ${lit(b.vendorId)}, ${lit(b.invoiceId)}, ${lit(b.billNumber)}, ${lit(b.amount)}, ${lit(b.status)},
          ${lit(b.issueDate)}, ${lit(b.jobId)}, ${lit(b.jobName)}, ${lit(b.customer)}, ${lit(b.csi)},
          ${lit(b.pdfFileId)}, ${b.isSunset ? 1 : 0}, ${lit(now)})`,
    );
    for (const l of b.lines) {
      stmts.push(
        `INSERT INTO bill_line_index (bill_id, line_id, description, csi, qty, unit_price, amount)
         VALUES (${lit(id)}, ${lit(l.lineId)}, ${lit(l.description)}, ${lit(l.csi)},
            ${lit(l.qty)}, ${lit(l.unitPrice)}, ${lit(l.amount)})`,
      );
    }
    if (hasFts) {
      stmts.push(
        `INSERT INTO bill_fts (rowid, vendor, invoice, lines)
         VALUES (${lit(id)}, ${lit(b.vendor)}, ${lit(`${b.invoiceId} ${b.billNumber}`)}, ${lit(linesText(b))})`,
      );
    }
    id++;
  }

  // ~500 statements per batch keeps each round trip well under libSQL's limits.
  const CHUNK = 500;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await rawDb().batch(stmts.slice(i, i + CHUNK), "write");
  }
}

// ── Live source: sweep JobTread ──────────────────────────────────────────────

const isSunsetVendor = (name: string) => /sunset/i.test(name);

/**
 * Every vendorBill (all statuses) with its line items, straight from Pave. Pages
 * `organization.documents` at size 25 so the nested `costItems` connection is
 * safe from the 413 rule. A page that still errors on the rich shape retries on a
 * minimal field set, then (worst case) headers only — never stalling the sweep.
 */
export async function sweepJobTreadBills(cfg: PaveConfig): Promise<IndexedBill[]> {
  const richLine = {
    id: {}, name: {}, description: {}, quantity: {}, unitCost: {}, cost: {},
    costCode: { number: {}, name: {} },
  };
  const richDoc = {
    id: {}, number: {}, externalId: {}, fromName: {}, status: {}, cost: {}, issueDate: {},
    account: { id: {}, name: {} },
    job: { id: {}, name: {} },
    costItems: { $: { size: 100 }, nodes: richLine },
  };
  const minDoc = {
    id: {}, number: {}, externalId: {}, fromName: {}, status: {}, cost: {}, issueDate: {},
    account: { id: {}, name: {} },
    job: { id: {}, name: {} },
    costItems: { $: { size: 100 }, nodes: { id: {}, name: {}, cost: {} } },
  };
  const headerDoc = {
    id: {}, number: {}, externalId: {}, fromName: {}, status: {}, cost: {}, issueDate: {},
    account: { id: {}, name: {} },
    job: { id: {}, name: {} },
  };

  const q = (nodes: Record<string, unknown>, page?: string) => ({
    organization: {
      $: { id: cfg.orgId },
      id: {},
      documents: {
        $: {
          where: { and: [["type", "vendorBill"]] },
          size: DOC_PAGE_SIZE,
          ...(page ? { page } : {}),
        },
        nextPage: {},
        nodes,
      },
    },
  });

  const out: IndexedBill[] = [];
  let page: string | undefined;
  let guard = 0;

  do {
    let r: any;
    try {
      r = await pave(cfg, q(richDoc, page));
    } catch {
      try {
        r = await pave(cfg, q(minDoc, page));
      } catch {
        r = await pave(cfg, q(headerDoc, page)); // lines lost for this page, but we advance
      }
    }
    const nodes: any[] = r?.organization?.documents?.nodes ?? [];
    for (const d of nodes) {
      const vendor = String(d?.account?.name ?? d?.fromName ?? "").trim() || "Unknown vendor";
      const lines: IndexedLine[] = (d?.costItems?.nodes ?? []).map((l: any) => ({
        lineId: String(l?.id ?? ""),
        description: String(l?.name ?? l?.description ?? "").trim(),
        csi: String(l?.costCode?.number ?? "").trim(),
        qty: typeof l?.quantity === "number" ? l.quantity : 0,
        unitPrice: typeof l?.unitCost === "number" ? l.unitCost : 0,
        amount: typeof l?.cost === "number" ? l.cost : 0,
      }));
      out.push({
        source: "jobtread",
        jtDocId: String(d?.id ?? ""),
        expId: "",
        vendor,
        vendorId: String(d?.account?.id ?? ""),
        invoiceId: String(d?.externalId ?? "").trim(),
        billNumber: d?.number != null ? String(d.number) : "",
        amount: typeof d?.cost === "number" ? d.cost : 0,
        status: String(d?.status ?? "").trim(),
        issueDate: d?.issueDate ? String(d.issueDate).slice(0, 10) : "",
        jobId: String(d?.job?.id ?? ""),
        jobName: String(d?.job?.name ?? "").trim(),
        customer: "",
        csi: lines[0]?.csi ?? "",
        pdfFileId: "",
        isSunset: isSunsetVendor(vendor),
        lines,
      });
    }
    page = r?.organization?.documents?.nextPage || undefined;
  } while (page && ++guard < 2000);

  return out;
}

/**
 * Rebuild the live (JobTread) half of the index. Lock-guarded so only one sweep
 * runs at a time; `last_refresh_at` is written LAST so a sweep that dies partway
 * leaves the index "stale" and the next caller retries. Returns the bill count
 * swept, or null if another refresh already holds the lock.
 */
export async function reindexFromJobTread(cfg: PaveConfig): Promise<number | null> {
  await ensureDb();
  if (!(await acquireRefreshLock())) return null;
  try {
    const bills = await sweepJobTreadBills(cfg);
    await replaceSource("jobtread", bills);
    await setMeta("last_refresh_at", new Date().toISOString());
    return bills.length;
  } finally {
    await releaseRefreshLock();
  }
}

// ── History source: one-time seed from the Expenditure/lineItem sheets ─────────

interface SeedProgress {
  processed: number; // bills written this call
  scanned: number; // sheet rows consumed this call
  nextOffset: number;
  total: number;
  done: boolean;
}

/**
 * Import one page of pre-JobTread bills from the sheet archive. Idempotent: the
 * first page (offset 0) clears any prior sheet-sourced rows, then each page
 * appends. Only rows the sheet marks NOT-in-JobTread (`inJt=0`) are taken — the
 * live sweep owns everything else. Line items come from the normal `lineItem`
 * tab only (Electrical and Sunset-statement lines are skipped per the spec).
 * The caller loops until `done`.
 */
export async function seedFromSheet(offset = 0): Promise<SeedProgress> {
  await ensureDb();

  const payload = (await callAppsScriptOrThrow(
    { action: "listExpenditureHistory", offset, limit: SEED_PAGE_ROWS },
    { timeoutMs: 110_000 },
  )) as {
    columns: string[];
    rows: (string | number)[][];
    jobs: { id: string; label: string; customer?: string; project?: string }[];
    vendors: { id: string; name: string }[];
    scanned: number;
    total: number;
    done: boolean;
  };

  const col = Object.fromEntries((payload.columns ?? []).map((c, i) => [c, i]));
  const jobById = new Map((payload.jobs ?? []).map((j) => [j.id, j]));
  const vendorById = new Map((payload.vendors ?? []).map((v) => [v.id, v.name]));

  // Pre-JT rows only (inJt=0); collect their keys to fetch line items in a batch.
  const rows = (payload.rows ?? []).filter((r) => Number(r[col.inJt] ?? 0) === 0);
  const keys: string[] = [];
  for (const r of rows) {
    const expId = String(r[col.expId] ?? "").trim();
    const invoiceId = String(r[col.invoiceId] ?? "").trim();
    if (expId) keys.push(expId);
    if (invoiceId && invoiceId !== expId) keys.push(invoiceId);
  }

  const linesByKey = await fetchSheetLines(keys);

  const bills: IndexedBill[] = rows.map((r) => {
    const expId = String(r[col.expId] ?? "").trim();
    const invoiceId = String(r[col.invoiceId] ?? "").trim();
    const rawVendor = String(r[col.vendorId] ?? "").trim();
    const vendor = vendorById.get(rawVendor) || rawVendor || "Unknown vendor";
    const job = jobById.get(String(r[col.projectId] ?? "").trim());
    const y = Number(r[col.billYear] ?? 0);
    const m = Number(r[col.billMonth] ?? 0);
    const date =
      String(r[col.date] ?? "").trim() ||
      (y && m ? `${y}-${String(m).padStart(2, "0")}-01` : y ? `${y}-01-01` : "");
    // Merge the bill's own line buckets (ExpID and Invoice ID both key the tab).
    const lines = [...(linesByKey.get(expId) ?? []), ...(linesByKey.get(invoiceId) ?? [])];
    return {
      source: "sheet",
      jtDocId: "",
      expId,
      vendor,
      vendorId: rawVendor,
      invoiceId,
      billNumber: "",
      amount: typeof r[col.amount] === "number" ? (r[col.amount] as number) : Number(r[col.amount]) || 0,
      status: String(r[col.status] ?? "").trim(),
      issueDate: date,
      jobId: job?.id ?? "",
      jobName: job?.project ?? job?.label ?? "",
      customer: job?.customer ?? "",
      csi: String(r[col.csi] ?? "").trim(),
      pdfFileId: String(r[col.fileId] ?? "").trim(),
      isSunset: isSunsetVendor(vendor),
      lines,
    };
  });

  if (offset === 0) {
    // Fresh seed run: drop any prior sheet rows, then append this first page.
    await clearSource("sheet");
    await setMeta("seed_done", "0");
  }
  await bulkInsert(bills, await nextBillId(), await ftsAvailable());

  const nextOffset = offset + (payload.scanned ?? rows.length);
  const done = !!payload.done;
  if (done) await setMeta("seed_done", "1");

  return { processed: bills.length, scanned: payload.scanned ?? 0, nextOffset, total: payload.total ?? 0, done };
}

/** Pull the normal (non-Electrical, non-Statement) line items for a set of keys. */
async function fetchSheetLines(keys: string[]): Promise<Map<string, IndexedLine[]>> {
  const out = new Map<string, IndexedLine[]>();
  const uniq = [...new Set(keys)];
  for (let i = 0; i < uniq.length; i += SEED_LINE_BATCH) {
    const batch = uniq.slice(i, i + SEED_LINE_BATCH);
    const resp = (await callAppsScriptOrThrow(
      { action: "listExpenditureLines", keys: batch },
      { timeoutMs: 110_000 },
    )) as { lines: Record<string, { id: string; desc: string; csi: string; qty: number; price: number; amount: number; source: string }[]> };
    for (const [key, lines] of Object.entries(resp.lines ?? {})) {
      const kept = lines
        .filter((l) => (l.source ?? "") === "") // "" = normal lineItem; skip Electrical/Statement
        .map((l) => ({
          lineId: String(l.id ?? ""),
          description: String(l.desc ?? "").trim(),
          csi: String(l.csi ?? "").trim(),
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.price) || 0,
          amount: Number(l.amount) || 0,
        }));
      if (kept.length) out.set(key, kept);
    }
  }
  return out;
}

async function clearSource(source: "jobtread" | "sheet"): Promise<void> {
  if (await ftsAvailable()) {
    await rawDb().execute({
      sql: `DELETE FROM bill_fts WHERE rowid IN (SELECT id FROM bill_index WHERE source = ?)`,
      args: [source],
    });
  }
  await rawDb().execute({
    sql: `DELETE FROM bill_line_index WHERE bill_id IN (SELECT id FROM bill_index WHERE source = ?)`,
    args: [source],
  });
  await rawDb().execute({ sql: `DELETE FROM bill_index WHERE source = ?`, args: [source] });
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Turn free text into an FTS5 prefix-AND query: `"pref"* "plumb"*`. */
function toFtsQuery(q: string): string {
  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, "").trim())
    .filter(Boolean);
  return terms.map((t) => `"${t}"*`).join(" ");
}

const rowToResult = (b: Record<string, unknown>): Omit<BillSearchResult, "lines" | "matchedLines"> => ({
  id: Number(b.id),
  source: (b.source as "jobtread" | "sheet") ?? "jobtread",
  jtDocId: String(b.jt_doc_id ?? ""),
  expId: String(b.exp_id ?? ""),
  vendor: String(b.vendor ?? ""),
  invoiceId: String(b.invoice_id ?? ""),
  billNumber: String(b.bill_number ?? ""),
  amount: Number(b.amount ?? 0),
  status: String(b.status ?? ""),
  issueDate: String(b.issue_date ?? ""),
  jobId: String(b.job_id ?? ""),
  jobName: String(b.job_name ?? ""),
  customer: String(b.customer ?? ""),
  pdfFileId: String(b.pdf_file_id ?? ""),
  isSunset: Number(b.is_sunset ?? 0) === 1,
});

/**
 * Search vendors + invoice numbers + line text. Uses FTS5 ranked by bm25 when
 * available, else a LIKE scan. Returns each bill with the lines that contain the
 * query (so the UI can show WHY it matched), newest first within relevance.
 */
export async function searchBills(query: string): Promise<BillSearchResult[]> {
  await ensureDb();
  const q = query.trim();
  if (!q) return [];

  let billRows: Record<string, unknown>[] = [];

  if (await ftsAvailable()) {
    const match = toFtsQuery(q);
    if (!match) return [];
    try {
      const r = await rawDb().execute({
        sql: `SELECT b.* FROM bill_fts
                JOIN bill_index b ON b.id = bill_fts.rowid
               WHERE bill_fts MATCH ?
               ORDER BY bm25(bill_fts), b.issue_date DESC
               LIMIT ?`,
        args: [match, SEARCH_LIMIT],
      });
      billRows = r.rows as unknown as Record<string, unknown>[];
    } catch {
      billRows = await likeSearch(q);
    }
  } else {
    billRows = await likeSearch(q);
  }

  if (billRows.length === 0) return [];

  // One query for all matched bills' lines, then group in memory.
  const ids = billRows.map((b) => Number(b.id));
  const placeholders = ids.map(() => "?").join(",");
  const lineRes = await rawDb().execute({
    sql: `SELECT bill_id, line_id, description, csi, qty, unit_price, amount
            FROM bill_line_index WHERE bill_id IN (${placeholders})`,
    args: ids,
  });
  const linesByBill = new Map<number, IndexedLine[]>();
  for (const row of lineRes.rows as unknown as Record<string, unknown>[]) {
    const bid = Number(row.bill_id);
    const line: IndexedLine = {
      lineId: String(row.line_id ?? ""),
      description: String(row.description ?? ""),
      csi: String(row.csi ?? ""),
      qty: Number(row.qty ?? 0),
      unitPrice: Number(row.unit_price ?? 0),
      amount: Number(row.amount ?? 0),
    };
    (linesByBill.get(bid) ?? linesByBill.set(bid, []).get(bid)!).push(line);
  }

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const lineMatches = (l: IndexedLine) => {
    const hay = `${l.description} ${l.csi}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  };

  return billRows.map((b) => {
    const base = rowToResult(b);
    const lines = linesByBill.get(base.id) ?? [];
    return { ...base, lines, matchedLines: lines.filter(lineMatches) };
  });
}

/** LIKE fallback (no FTS5): match the whole phrase across vendor / invoice / line. */
async function likeSearch(q: string): Promise<Record<string, unknown>[]> {
  const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const r = await rawDb().execute({
    sql: `SELECT DISTINCT b.* FROM bill_index b
            LEFT JOIN bill_line_index l ON l.bill_id = b.id
           WHERE b.vendor LIKE ?1 ESCAPE '\\'
              OR b.invoice_id LIKE ?1 ESCAPE '\\'
              OR b.bill_number LIKE ?1 ESCAPE '\\'
              OR l.description LIKE ?1 ESCAPE '\\'
              OR l.csi LIKE ?1 ESCAPE '\\'
           ORDER BY b.issue_date DESC
           LIMIT ?2`,
    args: [like, SEARCH_LIMIT],
  });
  return r.rows as unknown as Record<string, unknown>[];
}
