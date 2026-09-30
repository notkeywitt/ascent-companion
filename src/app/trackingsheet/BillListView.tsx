"use client";

import type { Dispatch, SetStateAction } from "react";
import { Card, EmptyState, Label, Select } from "@/components/ui";
import { money } from "./BillCodingCard";
import type { BillRef } from "./Board";

/**
 * The Tracking Sheets board's By bill view: the month's bills, with the
 * Sunset Supply bills in a block of their own. Each row is drawn by the
 * board's `renderBillCard`.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * markup is the board's, unchanged.
 */
/** The dropdown's row for "no cost code at all" — "" is not a usable option value. */
const UNCODED_KEY = "__uncoded";

export function BillListView({
  billBlockOpen,
  billCodeFilter,
  billCodeOptions,
  c,
  filteredBills,
  mode,
  nonSunsetBills,
  nonSunsetTotal,
  renderBillCard,
  setBillBlockOpen,
  setBillCodeFilter,
  setSunsetBlockOpen,
  sunsetBills,
  sunsetBlockOpen,
  sunsetTotal,
}: {
  billBlockOpen: boolean;
  billCodeFilter: { key: string; label: string; codes: string[]; color?: string; } | null;
  billCodeOptions: { number: string; name: string; }[];
  c: (key: string, vars?: Record<string, string | number>) => string;
  filteredBills: BillRef[];
  mode: "bill" | "code" | "summary";
  nonSunsetBills: BillRef[];
  nonSunsetTotal: number;
  renderBillCard: (b: BillRef) => React.JSX.Element;
  setBillBlockOpen: Dispatch<SetStateAction<boolean>>;
  setBillCodeFilter: Dispatch<SetStateAction<{ key: string; label: string; codes: string[]; color?: string; } | null>>;
  setSunsetBlockOpen: Dispatch<SetStateAction<boolean>>;
  sunsetBills: BillRef[];
  sunsetBlockOpen: boolean;
  sunsetTotal: number;
}) {
  return (
    <>
            {mode === "bill" && filteredBills.length === 0 ? (
              /* A filter that empties the list takes its own strip down with it,
                 so the way out has to be here — otherwise the only way back to
                 the month is finding the right slice of the ring again. */
              <EmptyState>
                {billCodeFilter ? (
                  <>
                    No bills on {billCodeFilter.label} this month.{" "}
                    <button
                      type="button"
                      onClick={() => setBillCodeFilter(null)}
                      className="font-semibold text-accent underline"
                    >
                      Show every bill
                    </button>
                  </>
                ) : (
                  c("recode.empty.noBills")
                )}
              </EmptyState>
            ) : mode === "bill" ? (
              <>
                {nonSunsetBills.length > 0 && (
                  <Card pad={false} className="overflow-hidden">
                    {/* Folds like the Labor block above and the Sunset block
                        below, so the three panes of the month behave the same
                        way — but OPEN by default, because this is the list the
                        page exists to work through. Closing it is what makes
                        room to read the labor or the Sunset run on one screen. */}
                    <button
                      type="button"
                      onClick={() => setBillBlockOpen((v) => !v)}
                      aria-expanded={billBlockOpen}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5 lg:py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold">
                        <span
                          aria-hidden
                          className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
                            billBlockOpen ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        Bills ({nonSunsetBills.length} bill
                        {nonSunsetBills.length === 1 ? "" : "s"})
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {money(nonSunsetTotal)}
                      </span>
                    </button>
                    {billBlockOpen && (
                      <>
                        {/* The list's own way to the cost-code filter — the same
                            control, in the same place, as the labor list's
                            (components/TimeEntryList's TimeFilterStrip). The
                            ring above sets the same state, so picking a slice
                            moves this select and picking here lights that
                            slice: one filter, two ways in. */}
                        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-line-soft bg-neutral-50 px-3 py-2 dark:bg-ink-raised/50">
                          <div className="min-w-[10rem] flex-1">
                            <Label htmlFor="bill-code">Cost code</Label>
                            <Select
                              id="bill-code"
                              value={billCodeFilter?.key ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (!v) return setBillCodeFilter(null);
                                if (v === UNCODED_KEY)
                                  return setBillCodeFilter({
                                    key: v,
                                    label: "Uncoded",
                                    codes: [""],
                                  });
                                const opt = billCodeOptions.find((o) => o.number === v);
                                setBillCodeFilter({
                                  key: v,
                                  label: opt?.name ? `${v} ${opt.name}` : v,
                                  codes: [v],
                                });
                              }}
                              className="!py-1 !text-xs"
                            >
                              <option value="">All codes</option>
                              {billCodeOptions.map((o) => (
                                <option
                                  key={o.number || UNCODED_KEY}
                                  value={o.number || UNCODED_KEY}
                                >
                                  {o.number ? `${o.number} ${o.name}`.trim() : "Uncoded"}
                                </option>
                              ))}
                              {/* A pick made on the ring can name a set of codes
                                ("Other"), which no single row here stands for —
                                it is listed so the box never reads "All codes"
                                over a filtered list. */}
                              {billCodeFilter && billCodeFilter.codes.length > 1 && (
                                <option value={billCodeFilter.key}>{billCodeFilter.label}</option>
                              )}
                            </Select>
                          </div>
                        </div>
                        <ul className="divide-y divide-line-soft border-t border-line-soft">
                          {nonSunsetBills.map(renderBillCard)}
                        </ul>
                      </>
                    )}
                  </Card>
                )}

                {/* Sunset bills, folded into their own collapsible pane — the
                    same treatment as the Labor block above. Sunset's high
                    invoice count is noise when you're deciding where to move
                    money, so it's pushed to the bottom of the list and collapsed
                    by default; its cost is already in every figure on the page,
                    so folding it away never changes a number. */}
                {sunsetBills.length > 0 && (
                  <Card pad={false} className="mt-2 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSunsetBlockOpen((v) => !v)}
                      aria-expanded={sunsetBlockOpen}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5 lg:py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold">
                        <span
                          aria-hidden
                          className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
                            sunsetBlockOpen ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        Sunset ({sunsetBills.length} bill{sunsetBills.length === 1 ? "" : "s"})
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {money(sunsetTotal)}
                      </span>
                    </button>
                    {sunsetBlockOpen && (
                      <ul className="divide-y divide-line-soft border-t border-line-soft bg-neutral-50 dark:bg-ink-raised/50">
                        {sunsetBills.map(renderBillCard)}
                      </ul>
                    )}
                  </Card>
                )}
              </>
            ) : null}

    </>
  );
}
