/**
 * TSheets / QuickBooks balance import — PURE parsing + matching.
 *
 * Sick time and PTO are really kept in QuickBooks; TSheets exports a balance
 * CSV ("ascentbuildingcollc_pto_balances_<date>.csv") whose numbers are the
 * authoritative ones. This module turns that file into a plan: for each roster
 * employee, what their balance SHOULD be, and therefore what signed adjustment
 * the companion ledger needs so its balance lands on the CSV number.
 *
 * No DB, no network — so it is unit-testable and safe to import anywhere. The
 * server side (reading current balances, writing the adjustments) lives in
 * leaveService.ts.
 *
 * The export's columns are "Paid Time Off", "Sick" and "Vacation". The company
 * treats Paid Time Off + Vacation as ONE pool, so they are summed into `pto`;
 * "Sick" alone feeds `sick`.
 */
import type { LeaveType } from "@/lib/leave";

/** Column-header → leave type. Anything unmatched is ignored (name, id, group). */
export function columnLeaveType(header: string): LeaveType | null {
  const h = header.trim().toLowerCase();
  if (/sick/.test(h)) return "sick";
  if (/paid time off|^pto$|vacation/.test(h)) return "pto";
  return null;
}

/** One CSV line, already resolved to hours per leave type. */
export interface CsvBalanceRow {
  /** Stable key for this line — the username if present, else the name. Used to
   *  remember a manual employee mapping across imports. */
  key: string;
  name: string; // "First Last" as spelled in the CSV
  username: string; // TSheets login — often an email, sometimes a short handle
  email: string; // username when it looks like an email, else ""
  hours: Record<LeaveType, number>;
  /** The per-column numbers that fed `hours`, for the review screen. */
  columns: Array<{ header: string; leaveType: LeaveType; hours: number }>;
}

/** RFC-4180-ish CSV split: quoted fields, "" escapes, CR/LF tolerant. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const num = (v: string): number => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Normalized person name — lowercase, punctuation and spacing removed, so
 *  "Tyler O'Steen" and "tyler osteen" are the same person. */
export function normName(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

export interface ParsedBalanceCsv {
  rows: CsvBalanceRow[];
  /** Headers the parser recognised as balance columns, in file order. */
  balanceColumns: Array<{ header: string; leaveType: LeaveType }>;
  /** Headers it ignored — shown so a renamed export is obvious, not silent. */
  ignoredColumns: string[];
}

/** Parse the TSheets balance export. Throws only when there is no header row. */
export function parseBalanceCsv(text: string): ParsedBalanceCsv {
  const table = parseCsv(text);
  if (!table.length) throw new Error("That file has no rows.");
  const headers = table[0].map((h) => h.trim());
  const balanceColumns: Array<{ header: string; leaveType: LeaveType; index: number }> = [];
  const ignoredColumns: string[] = [];
  headers.forEach((h, i) => {
    const t = columnLeaveType(h);
    if (t) balanceColumns.push({ header: h, leaveType: t, index: i });
    else if (h) ignoredColumns.push(h);
  });
  if (!balanceColumns.length) {
    throw new Error(
      `No balance columns found. Expected a "Sick", "Paid Time Off" or "Vacation" column; saw: ${headers.join(", ")}`,
    );
  }
  const idx = (re: RegExp): number => headers.findIndex((h) => re.test(h.trim().toLowerCase()));
  const iFirst = idx(/^(fname|first ?name|first)$/);
  const iLast = idx(/^(lname|last ?name|last)$/);
  const iFull = idx(/^(name|employee|employee name)$/);
  const iUser = idx(/^(username|user|email|user name)$/);

  const rows: CsvBalanceRow[] = [];
  for (const cells of table.slice(1)) {
    const get = (i: number): string => (i >= 0 ? String(cells[i] ?? "").trim() : "");
    const name = [get(iFirst), get(iLast)].filter(Boolean).join(" ") || get(iFull);
    const username = get(iUser);
    if (!name && !username) continue;
    const hours: Record<LeaveType, number> = { sick: 0, pto: 0 };
    const columns: CsvBalanceRow["columns"] = [];
    for (const c of balanceColumns) {
      const h = num(String(cells[c.index] ?? ""));
      hours[c.leaveType] += h;
      columns.push({ header: c.header, leaveType: c.leaveType, hours: h });
    }
    rows.push({
      key: (username || name).toLowerCase(),
      name,
      username,
      email: /@/.test(username) ? username.toLowerCase() : "",
      hours: { sick: round2(hours.sick), pto: round2(hours.pto) },
      columns,
    });
  }
  return {
    rows,
    balanceColumns: balanceColumns.map(({ header, leaveType }) => ({ header, leaveType })),
    ignoredColumns,
  };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Matching ──────────────────────────────────────────────────────────────────
export type MatchBy = "override" | "email" | "name" | "none";

export interface RosterRef {
  employeeId: string;
  name: string;
  email: string;
  jtUserId: string;
}

/** Resolve one CSV line to a roster employee. `overrides` (csv key → employeeId,
 *  "" = deliberately skip this person) wins over any automatic match. */
export function matchRow(
  row: CsvBalanceRow,
  roster: RosterRef[],
  overrides: Record<string, string> = {},
): { employee: RosterRef | null; matchedBy: MatchBy; skipped: boolean } {
  if (Object.prototype.hasOwnProperty.call(overrides, row.key)) {
    const id = overrides[row.key];
    if (!id) return { employee: null, matchedBy: "override", skipped: true };
    const emp = roster.find((r) => r.employeeId === id) ?? null;
    return { employee: emp, matchedBy: "override", skipped: false };
  }
  if (row.email) {
    const byEmail = roster.find((r) => r.email && r.email.toLowerCase() === row.email);
    if (byEmail) return { employee: byEmail, matchedBy: "email", skipped: false };
  }
  const want = normName(row.name);
  if (want) {
    const byName = roster.filter((r) => normName(r.name) === want);
    // Exactly one — an ambiguous name is left unmatched for a manual choice.
    if (byName.length === 1) return { employee: byName[0], matchedBy: "name", skipped: false };
  }
  return { employee: null, matchedBy: "none", skipped: false };
}

// ── The plan ──────────────────────────────────────────────────────────────────
export interface PlanChange {
  leaveType: LeaveType;
  current: number; // companion balance today
  target: number; // the CSV number
  delta: number; // adjustment hours to write (target − current)
}

export interface PlanRow {
  key: string;
  csvName: string;
  username: string;
  employeeId: string;
  employeeName: string;
  jtUserId: string;
  matchedBy: MatchBy;
  status: "change" | "unchanged" | "unmatched" | "skipped";
  changes: PlanChange[];
}

export interface ImportPlan {
  rows: PlanRow[];
  balanceColumns: Array<{ header: string; leaveType: LeaveType }>;
  ignoredColumns: string[];
  /** Roster people with no line in the CSV — flagged, never zeroed out. */
  missingFromCsv: Array<{ employeeId: string; name: string }>;
  counts: { rows: number; matched: number; unmatched: number; skipped: number; changes: number };
}

/**
 * Build the change plan. `currentBalance(employeeId, leaveType)` supplies what
 * the companion holds now; every difference becomes one signed adjustment.
 * A row is "unchanged" when both types already agree with the CSV (within a
 * cent of an hour), so re-importing the same file writes nothing.
 */
export function buildImportPlan(opts: {
  parsed: ParsedBalanceCsv;
  roster: RosterRef[];
  currentBalance: (employeeId: string, leaveType: LeaveType) => number;
  overrides?: Record<string, string>;
}): ImportPlan {
  const { parsed, roster, currentBalance, overrides = {} } = opts;
  const seen = new Set<string>();
  const rows: PlanRow[] = parsed.rows.map((r) => {
    const { employee, matchedBy, skipped } = matchRow(r, roster, overrides);
    if (employee) seen.add(employee.employeeId);
    const changes: PlanChange[] = [];
    if (employee && !skipped) {
      for (const leaveType of parsed.balanceColumns.map((c) => c.leaveType).filter(uniq)) {
        const target = round2(r.hours[leaveType]);
        const current = round2(currentBalance(employee.employeeId, leaveType));
        const delta = round2(target - current);
        changes.push({ leaveType, current, target, delta });
      }
    }
    const status: PlanRow["status"] = skipped
      ? "skipped"
      : !employee
        ? "unmatched"
        : changes.some((c) => Math.abs(c.delta) >= 0.01)
          ? "change"
          : "unchanged";
    return {
      key: r.key,
      csvName: r.name,
      username: r.username,
      employeeId: employee?.employeeId ?? "",
      employeeName: employee?.name ?? "",
      jtUserId: employee?.jtUserId ?? "",
      matchedBy,
      status,
      changes,
    };
  });
  const missingFromCsv = roster
    .filter((r) => !seen.has(r.employeeId))
    .map((r) => ({ employeeId: r.employeeId, name: r.name }));
  return {
    rows,
    balanceColumns: parsed.balanceColumns,
    ignoredColumns: parsed.ignoredColumns,
    missingFromCsv,
    counts: {
      rows: rows.length,
      matched: rows.filter((r) => r.employeeId && r.status !== "skipped").length,
      unmatched: rows.filter((r) => r.status === "unmatched").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      changes: rows.reduce((n, r) => n + r.changes.filter((c) => Math.abs(c.delta) >= 0.01).length, 0),
    },
  };
}

function uniq<T>(v: T, i: number, a: T[]): boolean {
  return a.indexOf(v) === i;
}
