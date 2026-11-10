/**
 * TRACKING SHEET vs JOBTREAD — the comparison behind the monthly check's
 * tracking-sheet step. Pure: no fetching, no DB. The sheet's cells arrive from
 * Claude Code (read with the Google Sheets tool) and the JobTread lines from
 * the agent route; this module only does the arithmetic, so no total is ever
 * added up by a model.
 *
 * A legacy client's Google Tracking Sheet gets its month of bills from the
 * Apps Script sync (TrackingSheets.js, ascent-appscript):
 *
 *   'Sub/Vendor Invoices'  A:C   one row per code+vendor: CSI | Amount | Vendor
 *                          row 1 from column E: one column per cost code; each
 *                          column FILTERs its code's amounts; the last row
 *                          holds each column's total
 *   'Labor'                A:F  one row per code: CSI | hours | first | last |
 *                          rate | total; H:I "Total Labor Time" / "Total Labor Cost"
 *   'Tracking Sheet'       row 7 "CURRENT INVOICE", row 8 month labels
 *                          ("October '26"), row 9 LABOR | INVOICES | …; one
 *                          row per cost code from row 10, its INVOICES cell
 *                          pulling that code's column total
 *
 * The office's discrepancies are almost always one of: the sync missed a bill
 * (stale or skipped), a code with no column (its money never reaches the
 * Tracking Sheet tab), a broken formula (a column or INVOICES cell that does
 * not add up to its rows), or labor at a different rate than JobTread costed it
 * (the sheet prices a code at one rate; JobTread snapshots each person's rate). Each has its own `kind` because each has its own fix.
 */
import { isSalesTaxLine } from "@/lib/salesTax";
import { WARRANTY_CSI } from "@/lib/warranty";

export type Grid = (string | number | null | undefined)[][];

const CODE_RE = /^\d{2} \d{2} \d{2}$/;
const CENT = 0.005;

/** "$1,008.72" / "-$277.77" / "($20.64)" / " $ 202.17 " → number; "" → null. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const neg = /^-|^\(.*\)$|-\s*\$/.test(s);
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits || digits === ".") return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const cell = (g: Grid, r: number, c: number) => String(g[r]?.[c] ?? "").trim();
const normCode = (v: unknown) => String(v ?? "").replace(/ /g, " ").trim().replace(/\s+/g, " ");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const SHEET_ERROR = /^#(REF!|N\/A|VALUE!|ERROR!|DIV\/0!|NAME\?|NUM!|NULL!)/i;

// ---------------------------------------------------------------- JobTread side

export interface JtLine {
  docId: string;
  bill: string;
  vendor: string;
  status: string;
  code: string;
  name: string;
  cost: number;
}

export interface JtCodeTotals {
  byCode: Record<string, { total: number; lines: JtLine[] }>;
  uncoded: JtLine[];
  excluded: { salesTax: number; warranty: number };
  total: number;
}

/** A month's bill lines, totalled the way the sync sends them: sales tax and
 *  warranty (88 90 00) never reach a tracking sheet. */
export function totalJtLines(
  bills: { id: string; label: string; vendor: string; status: string }[],
  lines: { docId: string; code: string; name: string; cost: number }[],
): JtCodeTotals {
  const byBill = new Map(bills.map((b) => [b.id, b]));
  const out: JtCodeTotals = { byCode: {}, uncoded: [], excluded: { salesTax: 0, warranty: 0 }, total: 0 };
  for (const l of lines) {
    const b = byBill.get(l.docId);
    if (!b) continue;
    const code = normCode(l.code);
    const line: JtLine = {
      docId: l.docId,
      bill: b.label,
      vendor: b.vendor,
      status: b.status,
      code,
      name: l.name,
      cost: round2(Number(l.cost) || 0),
    };
    if (isSalesTaxLine({ name: l.name, code })) {
      out.excluded.salesTax = round2(out.excluded.salesTax + line.cost);
      continue;
    }
    if (code === WARRANTY_CSI) {
      out.excluded.warranty = round2(out.excluded.warranty + line.cost);
      continue;
    }
    if (!CODE_RE.test(code)) {
      out.uncoded.push(line);
      continue;
    }
    const slot = (out.byCode[code] ??= { total: 0, lines: [] });
    slot.total = round2(slot.total + line.cost);
    slot.lines.push(line);
    out.total = round2(out.total + line.cost);
  }
  return out;
}

export interface JtLaborCode {
  hours: number;
  cost: number;
  /** Hours worked at each rate, e.g. { "75": 12.5, "85": 3 }. */
  hoursByRate: Record<string, number>;
  /** Who worked at each rate. */
  peopleByRate: Record<string, string[]>;
}

/** A month's time entries per cost code: hours, cost and the rates behind it. */
export function totalJtLabor(
  entries: { code: string; hours: number; cost: number; hourlyRate: number; employee: string }[],
): Record<string, JtLaborCode> {
  const out: Record<string, JtLaborCode> = {};
  for (const e of entries) {
    const code = normCode(e.code) || "(uncoded)";
    const slot = (out[code] ??= { hours: 0, cost: 0, hoursByRate: {}, peopleByRate: {} });
    const rate = String(round2(Number(e.hourlyRate) || 0));
    slot.hours += Number(e.hours) || 0;
    slot.cost += Number(e.cost) || 0;
    slot.hoursByRate[rate] = (slot.hoursByRate[rate] ?? 0) + (Number(e.hours) || 0);
    const people = (slot.peopleByRate[rate] ??= []);
    if (e.employee && !people.includes(e.employee)) people.push(e.employee);
  }
  for (const v of Object.values(out)) {
    v.hours = round2(v.hours);
    v.cost = round2(v.cost);
    for (const k of Object.keys(v.hoursByRate)) v.hoursByRate[k] = round2(v.hoursByRate[k]);
  }
  return out;
}

// ---------------------------------------------------------------- the sheet

export interface SubVendorTab {
  /** Sum of the A:C rows per code. */
  rows: Record<string, number>;
  rowsTotal: number;
  /** Row-1 header code → its column letter. */
  columns: Record<string, string>;
  /** Column letter → the value in the totals row. */
  columnTotals: Record<string, number | null>;
  duplicateColumns: string[];
  errors: string[];
}

/** Read the 'Sub/Vendor Invoices' tab, as get_values returns it from A1. */
export function readSubVendor(g: Grid): SubVendorTab {
  const rows: Record<string, number> = {};
  let rowsTotal = 0;
  for (let r = 0; r < g.length; r++) {
    const code = normCode(cell(g, r, 0));
    if (!CODE_RE.test(code)) continue;
    const amt = parseMoney(cell(g, r, 1));
    if (amt === null) continue;
    rows[code] = round2((rows[code] ?? 0) + amt);
    rowsTotal = round2(rowsTotal + amt);
  }

  const columns: Record<string, string> = {};
  const duplicateColumns: string[] = [];
  const header = g[0] ?? [];
  for (let c = 4; c < header.length; c++) {
    const code = normCode(header[c]);
    if (!CODE_RE.test(code)) continue;
    if (columns[code]) duplicateColumns.push(code);
    else columns[code] = colLetter(c);
  }

  // The totals row: the LAST row with anything from column E on.
  let totalsRow = -1;
  for (let r = g.length - 1; r > 0; r--) {
    if ((g[r] ?? []).slice(4).some((v) => String(v ?? "").trim() !== "")) {
      totalsRow = r;
      break;
    }
  }
  const columnTotals: Record<string, number | null> = {};
  const errors: string[] = [];
  for (const [code, letter] of Object.entries(columns)) {
    const c = header.findIndex((v, i) => i >= 4 && colLetter(i) === letter);
    const raw = totalsRow > 0 ? cell(g, totalsRow, c) : "";
    if (SHEET_ERROR.test(raw)) errors.push(`Sub/Vendor ${letter}${totalsRow + 1} (${code}) shows ${raw}`);
    columnTotals[letter] = parseMoney(raw);
  }
  for (let r = 0; r < g.length; r++) {
    (g[r] ?? []).forEach((v, c) => {
      const s = String(v ?? "").trim();
      if (SHEET_ERROR.test(s)) {
        const at = `Sub/Vendor ${colLetter(c)}${r + 1} shows ${s}`;
        if (!errors.some((e) => e.startsWith(`Sub/Vendor ${colLetter(c)}${r + 1} `))) errors.push(at);
      }
    });
  }
  return { rows, rowsTotal, columns, columnTotals, duplicateColumns, errors };
}

/** The month's label as the sheet writes it: "October '26", "OCT '25", "SEPT '25". */
function isMonthLabel(label: string, year: number, month: number): boolean {
  const m = label.toLowerCase().match(/^([a-z]+)\.?\s*'?\s*(\d{2,4})$/);
  if (!m) return false;
  const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return m[1].slice(0, 3) === names[month - 1] && m[2].slice(-2) === String(year).slice(-2);
}

export interface LaborTab {
  rows: Record<string, { hours: number; rate: number | null; total: number | null; row: number }>;
  hoursTotal: number;
  costTotal: number;
  /** The tab's own "Total Labor Time" / "Total Labor Cost" cells. */
  statedHours: number | null;
  statedCost: number | null;
  errors: string[];
}

/** Read the 'Labor' tab, as get_values returns it from A1. */
export function readLabor(g: Grid): LaborTab {
  const rows: LaborTab["rows"] = {};
  let hoursTotal = 0;
  let costTotal = 0;
  let statedHours: number | null = null;
  let statedCost: number | null = null;
  const errors: string[] = [];
  for (let r = 0; r < g.length; r++) {
    (g[r] ?? []).forEach((v, c) => {
      const t = String(v ?? "").trim();
      if (SHEET_ERROR.test(t)) errors.push(`Labor ${colLetter(c)}${r + 1} shows ${t}`);
      if (/^total labor time$/i.test(t)) statedHours = parseMoney(cell(g, r, c + 1));
      if (/^total labor cost$/i.test(t)) statedCost = parseMoney(cell(g, r, c + 1));
    });
    const code = normCode(cell(g, r, 0));
    if (!CODE_RE.test(code)) continue;
    const hours = parseMoney(cell(g, r, 1)) ?? 0;
    const total = parseMoney(cell(g, r, 5));
    const prev = rows[code];
    rows[code] = prev
      ? { hours: round2(prev.hours + hours), rate: prev.rate, total: round2((prev.total ?? 0) + (total ?? 0)), row: prev.row }
      : { hours, rate: parseMoney(cell(g, r, 4)), total, row: r + 1 };
    hoursTotal = round2(hoursTotal + hours);
    costTotal = round2(costTotal + (total ?? 0));
  }
  return { rows, hoursTotal, costTotal, statedHours, statedCost, errors };
}

export interface BlockColumns {
  labor: string | null;
  invoices: string | null;
}

export interface InvoiceColumns {
  /** The CURRENT INVOICE block. */
  current: BlockColumns;
  /** The billing month's own block, when it has one. */
  month: BlockColumns;
}

/**
 * Where the LABOR and INVOICES columns are on the 'Tracking Sheet' tab, from
 * its header rows 7–9 (`headers` = get_values of 'Tracking Sheet'!A7:…9).
 */
export function findInvoiceColumns(headers: Grid, year: number, month: number): InvoiceColumns {
  const block = (from: number): BlockColumns => {
    const out: BlockColumns = { labor: null, invoices: null };
    for (let c = from; c < from + 6; c++) {
      const h = cell(headers, 2, c).toUpperCase();
      if (h === "LABOR" && !out.labor) out.labor = colLetter(c);
      if (h === "INVOICES" && !out.invoices) out.invoices = colLetter(c);
    }
    return out;
  };
  const none: BlockColumns = { labor: null, invoices: null };
  let current = none;
  (headers[0] ?? []).forEach((v, c) => {
    if (current === none && String(v ?? "").trim().toUpperCase() === "CURRENT INVOICE") current = block(c);
  });
  let monthCols = none;
  (headers[1] ?? []).forEach((v, c) => {
    if (monthCols === none && isMonthLabel(String(v ?? "").trim(), year, month)) monthCols = block(c);
  });
  return { current, month: monthCols };
}

// ---------------------------------------------------------------- the comparison

export type SheetIssueKind =
  | "not-synced" // JobTread's code total ≠ the sheet's rows for it
  | "uncoded-in-jt" // a JobTread line with no code — the sync cannot place it
  | "no-column" // code has rows but no Sub/Vendor column: never reaches the Tracking Sheet
  | "column-total-off" // a code column's total ≠ its rows: a broken formula
  | "not-on-tracking-tab" // code has money but no row on the Tracking Sheet tab
  | "tracking-tab-off" // a LABOR / INVOICES cell ≠ what feeds it
  | "labor-hours-off" // the Labor tab's hours for a code ≠ JobTread's
  | "labor-rate-off" // the sheet prices a code at a rate JobTread did not cost it at
  | "labor-cost-off" // same hours, same rate, different total
  | "labor-row-math" // a Labor row's hours × rate ≠ its total: a broken formula
  | "labor-total-off" // "Total Labor Cost" / "Total Labor Time" ≠ the rows
  | "sheet-error"; // a cell shows #REF!, #N/A, …

export interface SheetIssue {
  kind: SheetIssueKind;
  code: string;
  sheet: number | null;
  expected: number | null;
  where: string;
  detail: string;
  lines?: JtLine[];
}

export interface SheetCheckInput {
  year: number;
  month: number;
  jt: JtCodeTotals;
  /** JobTread labor for the month — omit to skip the labor checks. */
  jtLabor?: Record<string, JtLaborCode>;
  subVendor: Grid;
  /** 'Labor'!A1:… — omit to skip the Labor tab. */
  labor?: Grid;
  /** 'Tracking Sheet'!A7:…9 — omit to skip the Tracking Sheet tab. */
  headers?: Grid;
  /** 'Tracking Sheet'!A<firstRow>:A… — the code column. */
  codes?: Grid;
  /** Column letter → that column's cells from `firstRow` down. */
  columns?: Record<string, Grid>;
  firstRow?: number;
}

export interface SheetCheckResult {
  jtTotal: number;
  sheetTotal: number;
  difference: number;
  laborJt: { hours: number; cost: number } | null;
  laborSheet: { hours: number; cost: number } | null;
  invoiceColumns: InvoiceColumns | null;
  issues: SheetIssue[];
}

const money = (n: number | null) =>
  n === null ? "blank" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => `${round2(n)} h`;

function compareLabor(jtLabor: Record<string, JtLaborCode>, lab: LaborTab, issues: SheetIssue[]) {
  const codes = new Set([...Object.keys(jtLabor), ...Object.keys(lab.rows)]);
  for (const code of [...codes].sort()) {
    const jt = jtLabor[code] ?? { hours: 0, cost: 0, hoursByRate: {}, peopleByRate: {} };
    const row = lab.rows[code];
    const where = row ? `Labor row ${row.row}` : "Labor tab";
    const sheetHours = row?.hours ?? 0;
    const sheetCost = row?.total ?? 0;
    if (!row && jt.hours > 0) {
      issues.push({
        kind: "labor-hours-off",
        code,
        sheet: 0,
        expected: jt.hours,
        where,
        detail: `${code}: JobTread has ${hrs(jt.hours)} (${money(jt.cost)}) and the Labor tab has no row for it.`,
      });
      continue;
    }
    if (row && row.rate !== null && row.total !== null && Math.abs(round2(row.hours * row.rate) - row.total) > 0.01) {
      issues.push({
        kind: "labor-row-math",
        code,
        sheet: row.total,
        expected: round2(row.hours * row.rate),
        where,
        detail: `${code}: ${hrs(row.hours)} × ${money(row.rate)} is ${money(round2(row.hours * row.rate))}, but the row's total says ${money(row.total)}.`,
      });
    }
    // Both sides round hours to the hundredth, so 0.01 apart is rounding.
    if (Math.abs(jt.hours - sheetHours) > 0.011) {
      issues.push({
        kind: "labor-hours-off",
        code,
        sheet: sheetHours,
        expected: jt.hours,
        where,
        detail: `${code}: JobTread ${hrs(jt.hours)} (${money(jt.cost)}), Labor tab ${hrs(sheetHours)} (${money(sheetCost)}).`,
      });
      continue;
    }
    const otherRates = Object.entries(jt.hoursByRate).filter(([r]) => row?.rate == null || Math.abs(Number(r) - row.rate) > 0.005);
    if (otherRates.length) {
      const parts = Object.entries(jt.hoursByRate)
        .map(([r, h]) => `${hrs(h)} at ${money(Number(r))} (${(jt.peopleByRate[r] ?? []).join(", ") || "?"})`)
        .join("; ");
      issues.push({
        kind: "labor-rate-off",
        code,
        sheet: sheetCost,
        expected: jt.cost,
        where,
        detail: `${code}: the Labor tab prices ${hrs(sheetHours)} at ${money(row?.rate ?? null)}/h = ${money(sheetCost)}; JobTread costed ${parts} = ${money(jt.cost)}. Difference ${money(round2(jt.cost - sheetCost))}.`,
      });
      continue;
    }
    // Same hours to the hundredth and the same rate: anything over a dollar is
    // not rounding.
    if (Math.abs(jt.cost - sheetCost) > 1) {
      issues.push({
        kind: "labor-cost-off",
        code,
        sheet: sheetCost,
        expected: jt.cost,
        where,
        detail: `${code}: same hours and rate, but JobTread ${money(jt.cost)} vs Labor tab ${money(sheetCost)}.`,
      });
    }
  }
  if (lab.statedCost !== null && Math.abs(lab.statedCost - lab.costTotal) > 0.01) {
    issues.push({
      kind: "labor-total-off",
      code: "",
      sheet: lab.statedCost,
      expected: lab.costTotal,
      where: "Labor tab, Total Labor Cost",
      detail: `"Total Labor Cost" says ${money(lab.statedCost)}; the code rows add to ${money(lab.costTotal)}. Its formula misses or double-counts rows.`,
    });
  }
  if (lab.statedHours !== null && Math.abs(lab.statedHours - lab.hoursTotal) > 0.011) {
    issues.push({
      kind: "labor-total-off",
      code: "",
      sheet: lab.statedHours,
      expected: lab.hoursTotal,
      where: "Labor tab, Total Labor Time",
      detail: `"Total Labor Time" says ${hrs(lab.statedHours)}; the code rows add to ${hrs(lab.hoursTotal)}.`,
    });
  }
  for (const e of lab.errors) {
    issues.push({ kind: "sheet-error", code: "", sheet: null, expected: null, where: "Labor tab", detail: e });
  }
}

export function compareTrackingSheet(input: SheetCheckInput): SheetCheckResult {
  const { jt } = input;
  const sv = readSubVendor(input.subVendor);
  const issues: SheetIssue[] = [];

  // 1. JobTread vs the synced rows, per code.
  const codes = new Set([...Object.keys(jt.byCode), ...Object.keys(sv.rows)]);
  for (const code of [...codes].sort()) {
    const want = jt.byCode[code]?.total ?? 0;
    const have = sv.rows[code] ?? 0;
    if (Math.abs(want - have) > CENT) {
      issues.push({
        kind: "not-synced",
        code,
        sheet: have,
        expected: want,
        where: "Sub/Vendor Invoices, columns A:C",
        detail: `${code}: JobTread ${money(want)}, sheet rows ${money(have)} (${money(round2(Math.abs(want - have)))} ${want > have ? "missing from" : "extra on"} the sheet).`,
        lines: jt.byCode[code]?.lines ?? [],
      });
    }
  }
  for (const l of jt.uncoded) {
    issues.push({
      kind: "uncoded-in-jt",
      code: "",
      sheet: null,
      expected: l.cost,
      where: "JobTread",
      detail: `${l.vendor} ${l.bill}: a ${money(l.cost)} line ("${l.name}") has no cost code, so the sync cannot place it.`,
      lines: [l],
    });
  }

  // 2. Every code with rows needs a column, and the column must add up.
  for (const [code, amt] of Object.entries(sv.rows)) {
    const letter = sv.columns[code];
    if (!letter) {
      if (Math.abs(amt) > CENT) {
        issues.push({
          kind: "no-column",
          code,
          sheet: null,
          expected: amt,
          where: "Sub/Vendor Invoices, row 1",
          detail: `${code} has ${money(amt)} of rows but no column in row 1, so it never reaches the Tracking Sheet tab. Add the code's column (in ascending position).`,
        });
      }
      continue;
    }
    const total = sv.columnTotals[letter] ?? null;
    if (total === null ? Math.abs(amt) > CENT : Math.abs(total - amt) > CENT) {
      issues.push({
        kind: "column-total-off",
        code,
        sheet: total,
        expected: amt,
        where: `Sub/Vendor Invoices, column ${letter}`,
        detail: `${code} column ${letter} totals ${money(total)} but its rows add to ${money(amt)} — the column's FILTER or total formula is broken.`,
      });
    }
  }
  for (const code of sv.duplicateColumns) {
    issues.push({
      kind: "column-total-off",
      code,
      sheet: null,
      expected: sv.rows[code] ?? 0,
      where: "Sub/Vendor Invoices, row 1",
      detail: `${code} has two columns in row 1; only one can be pulled onto the Tracking Sheet tab.`,
    });
  }
  for (const e of sv.errors) {
    issues.push({ kind: "sheet-error", code: "", sheet: null, expected: null, where: "Sub/Vendor Invoices", detail: e });
  }

  // 3. Labor: JobTread's hours and rates vs the Labor tab.
  const lab = input.labor ? readLabor(input.labor) : null;
  let laborJt: SheetCheckResult["laborJt"] = null;
  if (input.jtLabor) {
    const all = Object.values(input.jtLabor);
    laborJt = { hours: round2(all.reduce((a, v) => a + v.hours, 0)), cost: round2(all.reduce((a, v) => a + v.cost, 0)) };
  }
  if (lab && input.jtLabor) compareLabor(input.jtLabor, lab, issues);

  // 4. The Tracking Sheet tab's LABOR and INVOICES cells pull those figures.
  let invoiceColumns: InvoiceColumns | null = null;
  if (input.headers && input.codes && input.columns) {
    invoiceColumns = findInvoiceColumns(input.headers, input.year, input.month);
    const first = input.firstRow ?? 10;
    const rowOf = new Map<string, number>();
    input.codes.forEach((r, i) => {
      const code = normCode(r?.[0]);
      if (CODE_RE.test(code) && !rowOf.has(code)) rowOf.set(code, i);
    });
    const invoicesFeed: Record<string, number> = {};
    for (const [code, amt] of Object.entries(sv.rows)) {
      invoicesFeed[code] = sv.columns[code] ? sv.columnTotals[sv.columns[code]] ?? amt : amt;
    }
    const laborFeed: Record<string, number> = {};
    if (lab) for (const [code, r] of Object.entries(lab.rows)) laborFeed[code] = r.total ?? 0;

    const blocks: { label: string; cols: BlockColumns; current: boolean }[] = [
      { label: "CURRENT INVOICE", cols: invoiceColumns.current, current: true },
      { label: "month block", cols: invoiceColumns.month, current: false },
    ];
    for (const b of blocks) {
      for (const [what, letter, feed] of [
        ["INVOICES", b.cols.invoices, invoicesFeed],
        ["LABOR", b.cols.labor, lab ? laborFeed : null],
      ] as const) {
        if (!letter || !feed) continue;
        const col = input.columns[letter];
        if (!col) continue;
        // A month block is compared only once it has been filled (finalized).
        if (!b.current && !col.some((r) => (parseMoney(r?.[0]) ?? 0) !== 0)) continue;
        for (const [code, expected] of Object.entries(feed)) {
          if (Math.abs(expected) <= CENT) continue;
          const i = rowOf.get(code);
          if (i === undefined) {
            if (b.current) {
              issues.push({
                kind: "not-on-tracking-tab",
                code,
                sheet: null,
                expected,
                where: "Tracking Sheet, column A",
                detail: `${code} has ${money(expected)} of ${what === "LABOR" ? "labor" : "bills"} but no row on the Tracking Sheet tab. Add the code's row.`,
              });
            }
            continue;
          }
          const raw = String(col[i]?.[0] ?? "").trim();
          const ref = `${letter}${first + i}`;
          if (SHEET_ERROR.test(raw)) {
            issues.push({ kind: "sheet-error", code, sheet: null, expected, where: `Tracking Sheet ${ref}`, detail: `${code} ${b.label} ${what} (${ref}) shows ${raw}.` });
            continue;
          }
          const have = parseMoney(raw) ?? 0;
          if (Math.abs(have - expected) > CENT) {
            issues.push({
              kind: "tracking-tab-off",
              code,
              sheet: have,
              expected,
              where: `Tracking Sheet ${ref}`,
              detail: `${code} ${b.label} ${what} (${ref}) shows ${money(have)}; the ${what === "LABOR" ? "Labor tab row" : "Sub/Vendor column"} says ${money(expected)}. Check the cell's lookup formula.`,
            });
          }
        }
      }
    }
  }

  return {
    jtTotal: jt.total,
    sheetTotal: sv.rowsTotal,
    difference: round2(jt.total - sv.rowsTotal),
    laborJt,
    laborSheet: lab ? { hours: lab.hoursTotal, cost: lab.costTotal } : null,
    invoiceColumns,
    issues,
  };
}
