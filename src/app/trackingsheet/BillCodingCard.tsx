"use client";

import type { Dispatch, SetStateAction } from "react";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, type JobRef } from "@/components/JobPicker";
import { JtLink } from "@/components/JtLink";
import { Banner, Button, Card, EmptyState, Label, SectionLabel, Select } from "@/components/ui";
import type { LineEdit } from "@/lib/billLineMath";
import { round2 } from "@/lib/billLineMath";

/**
 * THE CODING CARD — the one place a vendor bill gets coded, wherever you
 * reached it from.
 *
 * Tracking Sheets shows this card in two different contexts:
 *
 *   - with a job selected, as the right column of the job workbench (Board.tsx),
 *     against that job's month of bills;
 *   - with NO job selected, as the right column of the needs-coding queue
 *     (DraftWorkbench.tsx), against whichever draft in the all-jobs list is
 *     picked.
 *
 * They used to be two hand-written cards, which is exactly how they drifted:
 * an edit to one (the Bill Number field, say) simply didn't appear in the
 * other. So the MARKUP lives here once and both callers render it. What
 * differs between them — where the bill came from, how a write is refreshed,
 * whether coding is staged for a page-level Sync or saved a bill at a time —
 * is supplied through `CodingCardCtl` and never forked inside the JSX.
 *
 * Adding something to the card? Add it here, and both surfaces get it.
 */

/** A file attached to the bill — the scan the coding decision is read off. */
export interface BillFile {
  id: string;
  name?: string;
  type?: string;
  url?: string;
}

export const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money0 = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const isImageFile = (f: BillFile) =>
  /^image\//i.test(f.type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");

/** The bill the card is coding, as both callers can describe it. */
export interface CodingBill {
  id: string;
  label: string;
  cost: number;
  status?: string;
  reviewed?: boolean;
  /** On a customer invoice already — coding goes read-only rather than
      changing numbers the client has been sent. */
  invoiced?: boolean;
  nonRecoverableTaxName?: string | null;
  /** JobTread's own document number, shown as the Bill Number placeholder. */
  number?: string | null;
  issueDate?: string | null;
}

/**
 * One line of that bill — the same shape as Board's JobBillLine, deliberately.
 * The card hands lines back to host callbacks (leafOf, buybackLineById, …), so
 * a narrower type here would make those callbacks unassignable; matching the
 * wider shape is what lets Board pass its own functions in unchanged.
 */
export interface CodingLine {
  id: string;
  docId: string;
  /** draft | pending | approved — draft cost isn't committed spend yet. */
  billStatus: string;
  name: string;
  cost: number;
  quantity?: number;
  unitCost?: number;
  /** The cost-code number the line sits on today. */
  code: string;
  codeName: string;
  jobCostItemId: string | null;
}

/** The bill math from billLineMath, as the card consumes it. */
interface CardMath {
  isDraft: boolean;
  subtotal: number;
  total: number;
  deTax: (stored: number) => number;
  targets: { qty: number; preTaxUnit: number; curPreTaxUnit: number }[];
}

/**
 * Everything the card needs from its host. Deliberately a single object rather
 * than forty props: both callers assemble one of these from state they already
 * hold, and a new field added here shows up as one compile error per caller
 * instead of silently rendering nothing on one of them.
 */
export interface CodingCardCtl {
  /* ---- what is being coded ---- */
  bill: CodingBill | null;
  lines: CodingLine[];
  math: CardMath;
  jobId: string;
  /** Office-edited wording (Admin → Page Text). */
  c: (key: string) => string;

  /* ---- gates ---- */
  /** COMPANION_WRITES_ENABLED, as the server reported it. */
  writes: boolean;

  /* ---- coding ---- */
  codeOptions: Option[];
  /** The budget leaf a line is coded to right now, staged edits included. */
  leafOf: (l: CodingLine) => string;
  /** …and that leaf's cost-code number. */
  codeOf: (l: CodingLine) => string;
  /** Stage a line onto a leaf. Whether that writes now or on a later Sync is
      the host's business, not the card's. */
  stageLine: (lineId: string, leafId: string, originalLeafId: string | null) => void;
  /** Line ids moved from where JobTread has them — drives the "moved from" mark. */
  staged: { has: (lineId: string) => boolean };
  /** Dollars left on a cost code, or null when the host has no figure for it. */
  remainingFor: (code: string) => number | null;
  bulkCode: string;
  setBulkCode: (v: string) => void;
  applyCodeToAll: (leafId: string) => void;

  /* ---- line fields (draft bills only) ---- */
  edits: Record<string, LineEdit | undefined>;
  setLineEdit: (lineId: string, patch: LineEdit) => void;

  /* ---- document-level sales tax ---- */
  taxEdit: string | null;
  storedTax: number;
  taxView: number;
  setTax: (v: string) => void;

  /* ---- reviewed marker ---- */
  toggleReviewed: (docId: string, reviewed: boolean) => void;

  /* ---- structural edits: these WRITE immediately on both surfaces ---- */
  isCombinable: (l: CodingLine) => boolean;
  anyCombinable: boolean;
  combineSelected: string[];
  toggleCombineSel: (id: string) => void;
  combineCodeSet: Set<string>;
  combineHasEdit: boolean;
  canCombine: boolean;
  combining: boolean;
  combineRows: () => void;
  combineMsg: string;

  buybackId: string;
  buybackLineById: (l: CodingLine, name: string, extended: number) => void;

  deletingLineId: string;
  deleteLineById: (id: string, label: string) => void;
  deleteLineMsg: string;

  addingLine: boolean;
  setAddingLine: (v: boolean) => void;
  newLine: { name: string; quantity: string; unitCost: string; code: string };
  setNewLine: Dispatch<SetStateAction<{ name: string; quantity: string; unitCost: string; code: string }>>;
  addLine: () => void;
  addLineSaving: boolean;
  addLineMsg: string;
  setAddLineMsg: (v: string) => void;

  /* ---- the scan ---- */
  files: BillFile[];
  filesLoading: boolean;

  /* ---- filing ---- */
  billNumberDraft: string;
  setBillNumberDraft: (v: string) => void;
  saveBillNumber: () => void;
  billNumberSaving: boolean;
  monthOptions: { value: string; label: string }[];
  setBillingMonth: (ym: string) => void;
  monthSaving: boolean;
  reassignJob: (j: JobRef) => void;
  reassigning: boolean;
  filingMsg: string;
}

export function BillCodingCard({ ctl }: { ctl: CodingCardCtl }) {
  const {
    bill,
    lines,
    math,
    jobId,
    c,
    writes,
    codeOptions,
    leafOf,
    codeOf,
    stageLine,
    staged,
    remainingFor,
    bulkCode,
    setBulkCode,
    applyCodeToAll,
    edits,
    setLineEdit,
    taxEdit,
    storedTax,
    taxView,
    setTax,
    toggleReviewed,
    isCombinable,
    anyCombinable,
    combineSelected,
    toggleCombineSel,
    combineCodeSet,
    combineHasEdit,
    canCombine,
    combining,
    combineRows,
    combineMsg,
    buybackId,
    buybackLineById,
    deletingLineId,
    deleteLineById,
    deleteLineMsg,
    addingLine,
    setAddingLine,
    newLine,
    setNewLine,
    addLine,
    addLineSaving,
    addLineMsg,
    setAddLineMsg,
    files,
    filesLoading,
    billNumberDraft,
    setBillNumberDraft,
    saveBillNumber,
    billNumberSaving,
    monthOptions,
    setBillingMonth,
    monthSaving,
    reassignJob,
    reassigning,
    filingMsg,
  } = ctl;

  return (
    <>
    <SectionLabel className="mb-2">Coding</SectionLabel>
    {!bill ? (
      <EmptyState>{c("recode.empty.selectBill")}</EmptyState>
    ) : (
      // Height-capped to the room left below the sticky top-16 so a
      // long bill still scrolls (within the card) instead of running
      // off-screen — independent of the section's own sticky position.
      <Card className="max-h-[calc(100vh-5rem)] overflow-y-auto">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold">{bill.label}</p>
          <JtLink
            href={`https://app.jobtread.com/jobs/${jobId}/documents/${bill.id}`}
            className="shrink-0 text-xs font-semibold text-neutral-400 transition hover:text-accent"
          >
            JT ↗
          </JtLink>
        </div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-neutral-500">
            {money(math.isDraft ? math.total : bill.cost)} ·{" "}
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {bill.status ? ` · ${bill.status}` : ""}
          </p>
          <Button
            variant={bill.reviewed ? "primary" : "secondary"}
            size="sm"
            className="shrink-0 !px-2 !py-1 !text-[11px]"
            onClick={() => toggleReviewed(bill.id, !bill.reviewed)}
          >
            {bill.reviewed ? "✓ Reviewed" : "Mark reviewed"}
          </Button>
        </div>

        {/* Document-level sales tax = JobTread's "Tax" (nonRecoverableTax),
            a fixed dollar. Staged like a line edit — nothing writes until
            Sync — so typing here moves math.total live. */}
        {math.isDraft && writes && !bill.invoiced && (
          <div className="mb-1 flex items-center justify-end gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-neutral-400">
              {bill.nonRecoverableTaxName || "Tax"}
            </span>
            <div className="relative">
              <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                $
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={taxEdit ?? String(storedTax)}
                onChange={(e) =>
                  setTax(e.target.value)
                }
                aria-label="Sales tax"
                className="w-24 rounded border border-neutral-300 bg-white py-1 pl-4 pr-1.5 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
              />
            </div>
          </div>
        )}
        {taxView > 0 && (
          <p className="mb-3 text-right text-[10px] text-neutral-400">
            subtotal {money(math.subtotal)} + {money(taxView)}{" "}
            {(bill.nonRecoverableTaxName || "tax").toLowerCase()}
          </p>
        )}

        {bill.invoiced && (
          <Banner tone="info" className="mb-3 !py-1.5 !text-[11px]">
            Already on a customer invoice — coding is read-only here so recoding can&apos;t
            change numbers already sent to the client.
          </Banner>
        )}

        {!bill.invoiced && codeOptions.length > 0 && lines.length > 1 && (
          <div className="mb-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-ink-raised/60">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
              Apply one code to all {lines.length} lines
            </span>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <CostCodeSelect options={codeOptions} value={bulkCode} onChange={setBulkCode} />
              </div>
              <Button
                size="sm"
                className="shrink-0 !py-1.5 !text-xs"
                onClick={() => applyCodeToAll(bulkCode)}
                disabled={!bulkCode}
              >
                Apply
              </Button>
            </div>
          </div>
        )}

        <ul className="space-y-3">
          {lines.map((l, i) => {
            const current = leafOf(l);
            const moved = staged.has(l.id);
            const code = codeOf(l);
            const left = remainingFor(code);
            const t = math.targets[i];
            const extended = t ? round2(t.qty * t.preTaxUnit) : math.deTax(l.cost);
            const setEdit = (patch: LineEdit) => setLineEdit(l.id, patch);
            return (
              <li
                key={l.id}
                className="border-t border-line-soft pt-3 first:border-0 first:pt-0 dark:border-neutral-800"
              >
                {/* Description. JobTread locks it (with qty/amount) once a
                    bill leaves draft, so those inputs only appear on
                    drafts; re-coding still works in any status. */}
                <div className="flex items-start gap-1.5">
                  {!bill.invoiced && writes && isCombinable(l) && (
                    <input
                      type="checkbox"
                      checked={combineSelected.includes(l.id)}
                      onChange={() => toggleCombineSel(l.id)}
                      aria-label="Select line to combine"
                      title="Combine with other lines that share this code"
                      className="mt-1.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {math.isDraft ? (
                      <input
                        value={edits[l.id]?.name ?? l.name ?? ""}
                        onChange={(e) => setEdit({ name: e.target.value })}
                        placeholder="Description"
                        className="mb-1 w-full rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                      />
                    ) : (
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-xs">
                          {l.name || "(unnamed line)"}
                        </span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {money(l.cost)}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Buyback: move this line onto a draft bill on Ascent -
                      Shop instead of billing it to the client (see
                      buybackLineById). Draft-only + writes-gated, like
                      Combine. Repeat clicks against other lines of THIS
                      bill land on the same Shop bill. */}
                  {math.isDraft && writes && (
                    <button
                      type="button"
                      onClick={() =>
                        buybackLineById(l, edits[l.id]?.name ?? l.name ?? "Line item", extended)
                      }
                      disabled={buybackId === l.id}
                      aria-label="Buy back to Ascent - Shop"
                      title="Move this line to a draft bill on Ascent - Shop"
                      className="mt-0.5 shrink-0 rounded p-1 text-neutral-400 transition hover:bg-accent/10 hover:text-accent disabled:opacity-40 dark:hover:bg-accent/20 dark:hover:text-accent-soft"
                    >
                      {buybackId === l.id ? (
                        <span className="block h-3.5 w-3.5 text-center text-[10px] leading-[14px]">
                          …
                        </span>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                        >
                          <path d="M4 12h13" />
                          <path d="M12 6l7 6-7 6" />
                        </svg>
                      )}
                    </button>
                  )}
                  {/* Delete: removes this line from the bill entirely —
                      ported from the bill page. Draft-only + writes-gated,
                      like Buyback/Combine/Add line. */}
                  {math.isDraft && writes && (
                    <button
                      type="button"
                      onClick={() =>
                        deleteLineById(l.id, edits[l.id]?.name ?? l.name ?? "Line item")
                      }
                      disabled={deletingLineId === l.id}
                      aria-label="Delete line"
                      title="Delete this line"
                      className="mt-0.5 shrink-0 rounded p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      {deletingLineId === l.id ? (
                        <span className="block h-3.5 w-3.5 text-center text-[10px] leading-[14px]">
                          …
                        </span>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"
                          />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
                {bill.invoiced ? (
                  <p className="rounded-md border border-line bg-neutral-50 px-2 py-1.5 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-ink-raised/60">
                    {code || "uncoded"}
                  </p>
                ) : (
                  <CostCodeSelect
                    options={codeOptions}
                    value={current}
                    onChange={(leafId) => stageLine(l.id, leafId, l.jobCostItemId)}
                  />
                )}
                {math.isDraft && t && (
                  /* Qty × pre-tax unit cost. The office types what
                     JobTread SHOWS (de-taxed); the save grosses every
                     line back up together. */
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      inputMode="decimal"
                      value={edits[l.id]?.quantity ?? String(l.quantity ?? 0)}
                      onChange={(e) => setEdit({ quantity: e.target.value })}
                      aria-label="Quantity"
                      className="w-14 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                    />
                    <span className="text-[11px] text-neutral-400">×</span>
                    <input
                      inputMode="decimal"
                      value={edits[l.id]?.unitCost ?? t.curPreTaxUnit.toFixed(2)}
                      onChange={(e) => setEdit({ unitCost: e.target.value })}
                      aria-label="Unit cost (pre-tax)"
                      className="w-24 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                    />
                    <span className="flex-1 text-right text-xs font-semibold tabular-nums">
                      {money(t.qty * t.preTaxUnit)}
                    </span>
                  </div>
                )}
                <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
                  <span className={moved ? "text-amber-600 dark:text-amber-400" : "text-neutral-400"}>
                    {moved ? `moved from ${l.code || "uncoded"}` : "unchanged"}
                  </span>
                  {left !== null && (
                    <span
                      className={
                        left < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-400"
                      }
                    >
                      {money0(left)} left on {code}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {deleteLineMsg && (
          <Banner tone="neutral" className="mt-2 !px-2 !py-1.5 !text-[11px]">
            {deleteLineMsg}
          </Banner>
        )}

        {/* Combine rows: appears once 2+ of this bill's lines share a
            code. Sits below the list, alongside Add line, since both
            are structural edits rather than per-line coding decisions.
            Unlike a recode, this writes to JobTread immediately — it's
            a structural merge, not a trial-and-error choice. */}
        {!bill.invoiced && writes && anyCombinable && (
          <div className="mt-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-ink-raised/60">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
              Combine lines sharing a code
            </span>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-[11px] text-neutral-500">
                {combineSelected.length < 2
                  ? "Check 2+ lines with the same code."
                  : combineCodeSet.size > 1
                    ? "Different codes selected."
                    : combineHasEdit
                      ? "Sync or discard edits first."
                      : `Merging ${combineSelected.length} lines.`}
              </p>
              <Button
                size="sm"
                className="shrink-0 !py-1.5 !text-xs"
                onClick={combineRows}
                disabled={!canCombine || combining}
              >
                {combining
                  ? "Combining…"
                  : `Combine${combineSelected.length >= 2 ? ` (${combineSelected.length})` : ""}`}
              </Button>
            </div>
            {combineMsg && (
              <Banner tone="neutral" className="mt-1.5 !px-2 !py-1.5 !text-[11px]">
                {combineMsg}
              </Banner>
            )}
          </div>
        )}

        {/* Add a new line (createCostItem) — ported from the bill page.
            Draft-only + writes-gated, like Delete/Combine/Buyback. */}
        {math.isDraft && writes && (
          <div className="mt-3">
            {!addingLine ? (
              <button
                type="button"
                onClick={() => {
                  setAddLineMsg("");
                  setAddingLine(true);
                }}
                className="w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/5 dark:border-neutral-700 dark:text-accent-soft"
              >
                + Add line
              </button>
            ) : (
              <div className="rounded-lg border border-line bg-white p-2 dark:bg-ink-raised">
                <input
                  type="text"
                  value={newLine.name}
                  onChange={(e) => setNewLine((n) => ({ ...n, name: e.target.value }))}
                  placeholder={c("recode.placeholder.lineDescription")}
                  className="w-full rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={newLine.quantity}
                    onChange={(e) => setNewLine((n) => ({ ...n, quantity: e.target.value }))}
                    aria-label="Quantity"
                    className="w-14 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                  />
                  <span className="text-[11px] text-neutral-400">×</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={newLine.unitCost}
                    onChange={(e) => setNewLine((n) => ({ ...n, unitCost: e.target.value }))}
                    aria-label="Unit cost (pre-tax)"
                    className="w-24 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                  />
                </div>
                <div className="mt-1.5">
                  <CostCodeSelect
                    options={codeOptions}
                    value={newLine.code}
                    onChange={(id) => setNewLine((n) => ({ ...n, code: id }))}
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    className="!py-1.5 !text-xs"
                    onClick={addLine}
                    disabled={addLineSaving || !newLine.name.trim()}
                  >
                    {addLineSaving ? "Adding…" : "Add line"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="!py-1.5 !text-xs"
                    onClick={() => {
                      setAddingLine(false);
                      setAddLineMsg("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {addLineMsg && (
              <Banner tone="neutral" className="mt-1.5 !px-2 !py-1.5 !text-[11px]">
                {addLineMsg}
              </Banner>
            )}
          </div>
        )}

        {/* The scanned invoice, in the panel where the coding decision is
            made — otherwise you're recoding a line from its description
            alone, or bouncing to the bill page to see what it was for. */}
        <div className="mt-4 border-t border-line-soft pt-3 dark:border-neutral-800">
          <SectionLabel className="mb-1.5">Invoice</SectionLabel>
          {filesLoading && <p className="text-xs text-neutral-400">Loading…</p>}
          {!filesLoading && files.length === 0 && (
            <p className="text-xs text-neutral-400">No file attached to this bill.</p>
          )}
          <div className="space-y-2">
            {files.map((f) =>
              f.url && isImageFile(f) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer" title="Open full size">
                  <img
                    src={f.url}
                    alt={f.name ?? "invoice"}
                    className="max-h-[32rem] w-full rounded-lg border border-line object-contain dark:border-neutral-800"
                  />
                </a>
              ) : f.url ? (
                <div key={f.id}>
                  <iframe
                    src={f.url}
                    title={f.name ?? "invoice"}
                    className="h-[32rem] w-full rounded-lg border border-line dark:border-neutral-800"
                  />
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-semibold text-accent"
                  >
                    Open {f.name || "attachment"} ↗
                  </a>
                </div>
              ) : (
                <span key={f.id} className="text-xs text-neutral-500">
                  {f.name}
                </span>
              ),
            )}
          </div>
        </div>

        {/* Filing — the bill page's Filing card, in the panel where the
            invoice is already on screen: both answers are read off the
            document, so they sit AFTER it, same as on /bill. Writes-
            gated like the rest of the card, and hidden on an invoiced
            bill, whose month and job are fixed by what the client was
            already sent. */}
        {writes && !bill.invoiced && (
          <div className="mt-4 border-t border-line-soft pt-3 dark:border-neutral-800">
            <SectionLabel className="mb-1.5">Filing</SectionLabel>
            {/* Vendor Bill Number (JobTread externalId) — the invoice/bill
                number, editable here; commits on blur. JobTread's own
                document number shows as the placeholder when it's unset. */}
            <Label htmlFor="filing-bill-number">Bill number</Label>
            <input
              id="filing-bill-number"
              type="text"
              value={billNumberDraft}
              maxLength={32}
              disabled={billNumberSaving || monthSaving || reassigning}
              onChange={(e) => setBillNumberDraft(e.target.value)}
              onBlur={saveBillNumber}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder={bill.number ? `#${bill.number}` : "Invoice / bill number"}
              className="mb-3 h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 font-mono text-xs transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50 dark:border-neutral-600 dark:bg-ink"
            />
            <Label htmlFor="filing-billing-month">Billing month</Label>
            <Select
              id="filing-billing-month"
              className="!py-1.5 !text-xs"
              disabled={monthSaving || reassigning}
              value={(bill.issueDate ?? "").slice(0, 7)}
              onChange={(e) => setBillingMonth(e.target.value)}
            >
              <option value="">— set billing month —</option>
              {monthOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>

            {/* Draft-only, like the bill page: JobTread locks a
                committed bill, and the move is a delete+recreate. */}
            {math.isDraft && (
              <div className="mt-3">
                <Label>Move to job</Label>
                {/* The picker is an action here, not a selection — what
                    it displays stays this board's job — so the move runs
                    off onSelect, which also hands back the label the
                    confirm and the banner name. */}
                <JobPicker
                  value={jobId}
                  includeAll={false}
                  placeholder={c("recode.placeholder.chooseJob")}
                  onChange={() => {}}
                  onSelect={(j) => {
                    if (j) reassignJob(j);
                  }}
                />
              </div>
            )}

            {(monthSaving || reassigning) && (
              <p className="mt-1.5 text-[11px] text-neutral-400">
                {reassigning ? "Moving…" : "Saving…"}
              </p>
            )}
            {filingMsg && (
              <Banner tone="neutral" className="mt-1.5 !px-2 !py-1.5 !text-[11px]">
                {filingMsg}
              </Banner>
            )}
          </div>
        )}
      </Card>
    )}
    </>
  );
}
