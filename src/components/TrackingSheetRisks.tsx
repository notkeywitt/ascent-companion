"use client";

import { Banner } from "@/components/ui";

/**
 * The "this money won't reach the Tracking Sheet" warning, shared by the Tracking
 * Sheet page and the Invoicing job cards.
 *
 * Three distinct failures, kept apart because the fix differs and because
 * lumping them together taught the office the wrong lesson — a code with a dead
 * column looks identical to a missing one but needs a different repair:
 *   unmatched      → no column for the code: add it (in ascending position).
 *   whitespaceOnly → column exists, header holds a non-breaking space. Reads
 *                    correctly on screen and can never match. Retype it.
 *   deadColumns    → column exists but has no FILTER/total formula, so it reads
 *                    $0 forever. repairTrackingSheetLookups() rebuilds it.
 */
export interface RiskCode {
  csi: string;
  amount: number;
  vendors?: string[];
  column?: string;
  missing?: string[];
}

const money = (n: number) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Group({
  codes,
  headline,
  fix,
  compact,
}: {
  codes: RiskCode[];
  headline: string;
  fix: string;
  compact: boolean;
}) {
  if (!codes.length) return null;
  const subtotal = codes.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  return (
    <div className="mt-1 first:mt-0">
      <p className="font-semibold">
        {headline} — {money(subtotal)}
      </p>
      {compact ? (
        <p className="opacity-90">
          {codes.map((c) => c.csi + (c.column ? `@${c.column}` : "")).join(", ")}
        </p>
      ) : (
        <ul className="mt-0.5">
          {codes.map((c) => (
            <li key={c.csi + (c.column ?? "")} className="flex justify-between gap-2">
              <span className="font-mono">
                {c.csi}
                {c.column ? <span className="opacity-70"> @{c.column}</span> : null}
              </span>
              <span className="min-w-0 flex-1 truncate opacity-80">
                {c.missing?.length ? `no ${c.missing.join(" + ")}` : (c.vendors ?? []).join(", ")}
              </span>
              <span className="font-semibold">{money(c.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-0.5 opacity-80">{fix}</p>
    </div>
  );
}

export function TrackingSheetRisks({
  unmatched = [],
  whitespaceOnly = [],
  deadColumns = [],
  compact = false,
  className = "",
}: {
  unmatched?: RiskCode[];
  whitespaceOnly?: RiskCode[];
  deadColumns?: RiskCode[];
  /** Compact renders one line of codes per group instead of a per-code table. */
  compact?: boolean;
  className?: string;
}) {
  const total = unmatched.length + whitespaceOnly.length + deadColumns.length;
  if (total === 0) return null;

  return (
    <Banner tone="warning" className={`text-xs ${className}`}>
      <Group
        codes={unmatched}
        compact={compact}
        headline={`${unmatched.length} cost code${unmatched.length === 1 ? "" : "s"} missing from the sheet`}
        fix="Add each code to row 1 of the SubVendor Invoices tab, in ascending position."
      />
      <Group
        codes={whitespaceOnly}
        compact={compact}
        headline={`${whitespaceOnly.length} header cell${whitespaceOnly.length === 1 ? "" : "s"} with a non-breaking space`}
        fix="The header looks right but can never match. Retype it with normal spaces, or run repairTrackingSheetLookups()."
      />
      <Group
        codes={deadColumns}
        compact={compact}
        headline={`${deadColumns.length} column${deadColumns.length === 1 ? "" : "s"} stuck reading $0`}
        fix="The column exists but lost its FILTER/total formula. repairTrackingSheetLookups() rebuilds it."
      />
    </Banner>
  );
}
