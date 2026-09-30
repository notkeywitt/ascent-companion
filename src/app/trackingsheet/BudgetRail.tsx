"use client";

import type { Dispatch, SetStateAction } from "react";
import type { TrackingTarget } from "@/components/TrackingSheetSync";
import { Card, ChipScroller, Meter, SectionLabel } from "@/components/ui";
import { remainingOf, usedOf, type Headroom } from "./headroom";
import { money, money0 } from "./BillCodingCard";
import { SheetGap } from "./SheetGap";

/**
 * The Tracking Sheets board's budget rail: every cost code with its budget,
 * what is charged against it and what is left, grouped by division. It is
 * the drop target for drag and drop, and a row opens the code drill-down.
 * The figures come from `headroom.ts`; the screen state from `useRailView`.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * markup is the board's, unchanged.
 */
export function BudgetRail({
  budgetByCode,
  c,
  canSheetGap,
  codeQuery,
  collapsedDivs,
  dragLineIds,
  dragOverCode,
  dropHandlers,
  headroomMostLeft,
  jobId,
  openCodeDrill,
  railCollapsed,
  railGroups,
  railHidden,
  railRows,
  setCodeQuery,
  setCollapsedDivs,
  setHeadroomMostLeft,
  setRailCollapsed,
  tightestCodes,
  toggleDiv,
  toggleRailHidden,
  trackingTarget,
}: {
  budgetByCode: Map<string, number>;
  c: (key: string, vars?: Record<string, string | number>) => string;
  canSheetGap: boolean;
  codeQuery: string;
  collapsedDivs: Set<string>;
  dragLineIds: string[] | null;
  dragOverCode: string | null;
  dropHandlers: (code: string, droppable: boolean) => { onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void; } | { onDragOver?: undefined; onDragLeave?: undefined; onDrop?: undefined; };
  headroomMostLeft: boolean;
  jobId: string;
  openCodeDrill: (code: string) => void;
  railCollapsed: boolean;
  railGroups: { budget: number; used: number; remaining: number; code: string; name: string; rows: Headroom[]; }[];
  railHidden: boolean;
  railRows: Headroom[];
  setCodeQuery: Dispatch<SetStateAction<string>>;
  setCollapsedDivs: Dispatch<SetStateAction<Set<string>>>;
  setHeadroomMostLeft: Dispatch<SetStateAction<boolean>>;
  setRailCollapsed: Dispatch<SetStateAction<boolean>>;
  tightestCodes: Headroom[];
  toggleDiv: (code: string) => void;
  toggleRailHidden: () => void;
  trackingTarget: TrackingTarget | null;
}) {
  return (
    <>
          {/* ─────────── LEFT: cost-code reference rail ─────────── */}
          {/* Docked: the rail is the reference you're constantly checking while
              scrolling a long bill list, so it stays put. `self-start` is what
              makes sticky work in a grid — items stretch to the row height by
              default, leaving nothing to scroll within. */}
          {/* The rail's own column, whether the rail is in it or not. Closed,
              the track is a fixed 3.5rem — 44px of button plus the `pr-3`
              gutter below — and holds nothing but the reopen tab.

              FIXED, NOT `max-content`, and that is the fix for the overlap: the
              tab is set in a vertical writing mode, and a grid track cannot
              measure an orthogonal flow's intrinsic inline size, so max-content
              came out short and the tab spilled over the "to be invoiced"
              figures beside it. SplitGrid's CLOSED_PX is the same number at xl;
              keep the two in step.

              `overflow-hidden` only while the rail is IN it: it is what clips
              the rail as the track narrows, and it would cut the tab's shadow
              off once the track is the tab.

              WHAT STICKS IS DIFFERENT IN THE TWO STATES, and this is the trap
              the coding drawer hit in August: a sticky element can only travel
              inside its own box, and `self-start` shrinks this item to its
              content. With the rail in it that content is a full column, so the
              SECTION sticks. Closed, the content is one small button — a sticky
              section there has nowhere to go and scrolls away after a few
              hundred pixels. So the section stretches to the row instead and the
              BUTTON does the sticking, with the whole row to travel in. */}
          <section
            className={`min-w-0 ${
              railHidden ? "lg:pr-3" : "overflow-hidden lg:sticky sticky-below-header lg:self-start"
            }`}
          >
            {/* THE WAY BACK, in the column the rail vacated. Desktop only:
                below lg the track is the whole width and the rail folds under
                its own heading instead, so a second control there would mean
                almost the same thing twice.

                The gutter is the section's own `lg:pr-3`, not a margin here: at
                xl the grid sets `gap-x-0` and the handle track beside a closed
                rail is 0px, so without it the tab butts straight against the
                "to be invoiced" card. Padding the column keeps the button's
                width and the track's width the same conversation. */}
            {railHidden && (
              <button
                type="button"
                onClick={toggleRailHidden}
                title="Show the budget column"
                className="sticky-below-header hidden w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-cream/95 py-3 text-[11px] font-semibold text-neutral-500 shadow-sm transition hover:border-accent hover:text-accent dark:bg-ink-raised dark:text-neutral-400 lg:sticky lg:flex [writing-mode:vertical-rl]"
              >
                <span aria-hidden className="text-[9px] [writing-mode:horizontal-tb]">
                  →
                </span>
                Budget
              </button>
            )}

            {/* The rail proper. `lg:hidden` rather than unmounted, because
                below lg `railHidden` means nothing and the rail is still the
                only budget on the page there. */}
            <div className={railHidden ? "lg:hidden" : ""}>
              {/* The row keeps a SectionHeading's 28px height on a phone even
                though both taps inside it are 44px tall: `-my-2` lets each
                button's hit area overhang the row instead of inflating it, the
                way a 44px target normally would. Without it this heading stood
                16px taller than every other heading on the page, and the
                collapsed rail left another 8px of dead margin under itself. */}
              <div
                className={`flex items-baseline justify-between gap-2 lg:mb-2 ${
                  railCollapsed ? "mb-0" : "mb-2"
                }`}
              >
                {/* On mobile the label itself is the toggle for the whole rail;
                  on desktop the rail is always docked, so the tap is disabled.
                  The mark is the ochre dash every other SectionHeading on the
                  page carries, not a rotating chevron — one heading style for
                  the whole page. What the fold is doing is then said by whether
                  the cards below are there, which on a phone is the whole
                  screen. */}
                <button
                  type="button"
                  onClick={() => setRailCollapsed((v) => !v)}
                  aria-expanded={!railCollapsed}
                  className="-ml-1 -my-2 flex min-h-11 min-w-0 items-center gap-2.5 px-1 text-left lg:pointer-events-none lg:my-0 lg:ml-0 lg:min-h-0 lg:px-0"
                >
                  <span aria-hidden className="h-0.5 w-5 shrink-0 rounded-full bg-accent" />
                  <SectionLabel>Budget</SectionLabel>
                </button>
                <span className="-my-2 flex shrink-0 items-center gap-3 lg:my-0">
                  {/* Which end of the headroom cards leads. Mobile only — the
                    cards themselves are, and on desktop the full rail below
                    answers the same question in order. */}
                  {tightestCodes.length > 0 && !railCollapsed && (
                    <button
                      type="button"
                      onClick={() => setHeadroomMostLeft((v) => !v)}
                      className="inline-flex min-h-11 items-center gap-1 text-[11px] text-neutral-500 transition hover:text-accent dark:text-neutral-400 lg:hidden"
                    >
                      {headroomMostLeft ? "most left first" : "least left first"}
                      <span aria-hidden className="text-[9px]">
                        ⇅
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedDivs((prev) =>
                        prev.size > 0 ? new Set() : new Set(railGroups.map((g) => g.code)),
                      )
                    }
                    className={`-mr-1 inline-flex min-h-11 shrink-0 items-center px-1 text-[11px] text-neutral-500 transition hover:text-accent dark:text-neutral-400 lg:mr-0 lg:min-h-0 lg:px-0 ${
                      railCollapsed ? "hidden lg:inline-flex" : ""
                    }`}
                  >
                    {collapsedDivs.size > 0 ? "Expand all" : "Collapse all"}
                  </button>
                  {/* Close the whole column. Desktop only — on a phone the
                    heading tap already folds the rail, and a second control
                    that means almost the same thing is two ways to do one
                    thing. A tab on the left edge brings it back. */}
                  <button
                    type="button"
                    onClick={toggleRailHidden}
                    title="Hide the budget column — the bills take the width"
                    className="hidden shrink-0 items-center gap-1 text-[11px] text-neutral-500 transition hover:text-accent dark:text-neutral-400 lg:inline-flex"
                  >
                    Hide
                    <span aria-hidden className="text-[9px]">
                      ←
                    </span>
                  </button>
                </span>
              </div>
              {/* Budget headroom, INSIDE the budget fold — same tap, one
                heading. The desktop rail is a docked column; below lg it is
                folded behind that tap, and these cards are what the budget
                looks like on the device the month is actually reviewed on.
                Swipeable; tapping a card opens the same drill-down the rail's
                rows do. Which end leads is the flip beside the heading. */}
              {tightestCodes.length > 0 && !railCollapsed && (
                <div className="mb-2 lg:hidden">
                  <ChipScroller bleed="1rem">
                    {tightestCodes.map((h) => {
                      const left = remainingOf(h);
                      const pct = Math.round((left / h.budget) * 100);
                      return (
                        <button
                          key={h.code}
                          type="button"
                          onClick={() => openCodeDrill(h.code)}
                          className="w-[170px] shrink-0 rounded-xl border border-line bg-white p-2.5 text-left transition hover:border-accent dark:bg-ink-raised"
                        >
                          <div className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                            {h.code}
                          </div>
                          <div className="truncate text-[12.5px] font-semibold">{h.name}</div>
                          <div
                            className={`mt-0.5 text-[15px] font-bold tabular-nums tracking-tight ${
                              left < 0 ? "text-red-600 dark:text-red-400" : ""
                            }`}
                          >
                            {money0(left)}
                          </div>
                          <Meter
                            budget={h.budget}
                            used={usedOf(h)}
                            label={h.code}
                            className="mt-1.5 h-1"
                          />
                          <div className="mt-1 text-[10.5px] text-neutral-500 dark:text-neutral-400">
                            {left < 0 ? `over by ${-pct}%` : `${pct}% of budget left`}
                          </div>
                        </button>
                      );
                    })}
                  </ChipScroller>
                </div>
              )}
              {/* Admin: what this job's Tracking Sheet says the spend is, against
                what JobTread holds — the historical gap, on the job you already
                have open. Folds with the rail like the headroom cards do. */}
              {canSheetGap && trackingTarget?.url && (
                <SheetGap
                  jobId={jobId}
                  url={trackingTarget.url}
                  budgetByCode={budgetByCode}
                  className={railCollapsed ? "hidden lg:block" : ""}
                />
              )}
              <Card
                pad={false}
                className={`overflow-hidden ${railCollapsed ? "hidden lg:block" : ""}`}
              >
                <input
                  type="search"
                  value={codeQuery}
                  onChange={(e) => setCodeQuery(e.target.value)}
                  placeholder={c("recode.placeholder.filterCodes")}
                  className="h-11 w-full border-b border-line bg-transparent px-3 text-xs outline-none dark:border-white/10 lg:h-auto lg:px-2 lg:py-1.5"
                />
                {/* Sized off the viewport, not a %, so the docked rail (label +
                  card + footnote) always fits on screen and scrolls internally.
                  `dvh` rather than `vh`, so a phone's collapsing address bar
                  doesn't leave the rail taller than the screen it's in. */}
                <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
                  {railRows.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-neutral-500">No cost codes match.</p>
                  ) : (
                    railGroups.map((g) => {
                      // A filter term force-opens the divisions it matched —
                      // otherwise searching a collapsed rail looks like it found
                      // nothing.
                      const open = !collapsedDivs.has(g.code) || codeQuery.trim() !== "";
                      return (
                        <div key={g.code}>
                          <button
                            type="button"
                            onClick={() => toggleDiv(g.code)}
                            aria-expanded={open}
                            // A collapsed division hides its codes, and with them
                            // their drop targets — so dragging onto the header
                            // opens it instead of dead-ending the drag.
                            onDragOver={() => {
                              if (dragLineIds && collapsedDivs.has(g.code)) toggleDiv(g.code);
                            }}
                            // Division headers and code rows are tap targets that
                            // open a drill-down, so on touch they get real height
                            // (they were ~26px); `lg` restores the dense rail the
                            // desktop workbench scans dozens of codes in.
                            className="w-full border-b border-line bg-neutral-50/80 px-3 py-2.5 text-left transition hover:bg-accent/5 dark:border-neutral-800 dark:bg-white/[0.04] dark:hover:bg-white/[0.07] lg:px-2 lg:py-1"
                          >
                            <div className="flex items-center gap-1.5 lg:items-baseline">
                              <span
                                aria-hidden
                                className={`shrink-0 text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${open ? "rotate-90" : ""}`}
                              >
                                ▶
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                <span className="font-normal tabular-nums text-neutral-500 dark:text-neutral-400">
                                  {g.code}
                                </span>{" "}
                                {g.name}
                              </span>
                              <span className="shrink-0 text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                                {g.rows.length}
                              </span>
                              <span
                                className={`shrink-0 text-sm font-semibold tabular-nums ${
                                  g.remaining < 0 ? "text-red-600 dark:text-red-400" : ""
                                }`}
                              >
                                {money0(g.remaining)}
                              </span>
                            </div>
                          </button>

                          {/* Rolled up, the division still shows its own bar, so a
                            tidy rail is still a readable one. */}
                          {!open && (
                            <div className="border-b border-line-soft px-2 pb-1 dark:border-neutral-800">
                              <Meter budget={g.budget} used={g.used} label={`Division ${g.code}`} />
                            </div>
                          )}

                          {open && (
                            <ul>
                              {g.rows.map((h) => {
                                const left = remainingOf(h);
                                const over = left < 0;
                                // Remaining ÷ budget — undefined without a real budget to
                                // divide by (a labor-only or bills-only code), same guard
                                // the Meter's own percentage uses. It is tooltip-only
                                // now: the row shows the money left and the bar, and
                                // a percent beside a dollar figure said the same thing
                                // twice.
                                const pct =
                                  h.budget > 0 ? Math.round((left / h.budget) * 100) : null;
                                return (
                                  // ONE line and a bar. The name, the money left and
                                  // the meter — the same type scale the bill list
                                  // beside it uses, so the two columns read as one
                                  // page. Everything else (used, budget, percent) is
                                  // in the tooltip and in the drill-down this row
                                  // opens; four lines per code made the rail a wall.
                                  <li
                                    key={h.code}
                                    {...dropHandlers(h.code, h.droppable)}
                                    title={
                                      `${h.code} ${h.name}\n` +
                                      `${money(h.spent)} committed` +
                                      (h.drafts > 0 ? ` + ${money(h.drafts)} draft` : "") +
                                      (h.labor > 0 ? ` + ${money(h.labor)} labor` : "") +
                                      ` of ${money(h.budget)} budget\n${money(left)} remaining` +
                                      (pct !== null ? ` (${pct}% of budget)` : "") +
                                      (h.droppable ? "" : "\nNo budget line — can't code to this")
                                    }
                                    className={`border-b border-line-soft transition dark:border-neutral-800 ${
                                      dragOverCode === h.code
                                        ? "bg-accent/10 ring-1 ring-inset ring-accent"
                                        : dragLineIds && !h.droppable
                                          ? "opacity-40"
                                          : ""
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => openCodeDrill(h.code)}
                                      className="w-full px-3 py-2.5 pl-5 text-left transition hover:opacity-70 lg:px-2 lg:py-1.5 lg:pl-4"
                                    >
                                      <div className="flex items-baseline justify-between gap-3">
                                        <span className="min-w-0 truncate text-sm font-semibold">
                                          <span className="font-normal tabular-nums text-neutral-500 dark:text-neutral-400">
                                            {h.code}
                                          </span>{" "}
                                          <span
                                            className={
                                              h.droppable
                                                ? ""
                                                : "font-normal text-neutral-500 dark:text-neutral-400"
                                            }
                                          >
                                            {h.name}
                                          </span>
                                        </span>
                                        <span
                                          className={`shrink-0 text-base font-semibold tabular-nums ${
                                            over ? "text-red-600 dark:text-red-400" : ""
                                          }`}
                                        >
                                          {money0(left)}
                                        </span>
                                      </div>
                                      <Meter
                                        budget={h.budget}
                                        used={usedOf(h)}
                                        label={h.code}
                                        className="mt-1"
                                      />
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>
          </section>

    </>
  );
}
