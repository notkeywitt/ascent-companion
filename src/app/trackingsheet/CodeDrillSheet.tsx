"use client";

import type { Dispatch, SetStateAction } from "react";
import { Banner, Button, Card, Chip, Loading, SectionLabel } from "@/components/ui";
import { JtLink } from "@/components/JtLink";
import { remainingOf, type Headroom } from "./headroom";
import { money } from "./BillCodingCard";
import type { CostCodeTimeContributor, DrillBillRow } from "./Board";

/**
 * The Tracking Sheets board's cost-code drill-down sheet: every bill and time
 * entry behind one rail row's total, so "why is this over budget" needs no
 * trip to the Tracking Sheet. A bottom sheet on a phone, a dialog from sm up.
 * The data comes from `useCodeDrill`.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * markup is the board's, unchanged.
 */
export function CodeDrillSheet({
  c,
  codeDrill,
  contributorsError,
  contributorsLoading,
  drillBills,
  drillTime,
  headroom,
  jobId,
  setCodeDrill,
}: {
  c: (key: string, vars?: Record<string, string | number>) => string;
  codeDrill: string | null;
  contributorsError: string;
  contributorsLoading: boolean;
  drillBills: DrillBillRow[];
  drillTime: CostCodeTimeContributor[];
  headroom: Map<string, Headroom>;
  jobId: string;
  setCodeDrill: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <>
      {/* Cost-code drill-down: every bill and time entry behind a rail row's
          total, so "why is this over budget" doesn't require a trip to the
          Tracking Sheet. */}
      {codeDrill && (
        // Bottom sheet on a phone, centred dialog from sm up: anchored to the
        // bottom edge it opens inside the thumb's reach and its Close button
        // lands where the hand already is, instead of at the top of a box
        // floating mid-screen. `dvh` keeps it inside the visible viewport when
        // the browser chrome collapses, and the safe-area pad keeps the last
        // row clear of the home indicator.
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setCodeDrill(null)}
        >
          <Card
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-b-none pb-[max(0.75rem,env(safe-area-inset-bottom))] !p-4 sm:rounded-b-xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const h = headroom.get(codeDrill);
              return (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold">
                      <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                        {codeDrill}
                      </span>{" "}
                      {h?.name ?? ""}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-11 shrink-0 sm:min-h-0"
                      onClick={() => setCodeDrill(null)}
                    >
                      Close
                    </Button>
                  </div>
                  {h && (
                    <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
                      {money(h.spent)} committed
                      {h.drafts > 0 ? ` + ${money(h.drafts)} draft` : ""}
                      {h.labor > 0 ? ` + ${money(h.labor)} labor` : ""}
                      {` of ${money(h.budget)} budget · `}
                      <span
                        className={
                          remainingOf(h) < 0 ? "font-semibold text-red-600 dark:text-red-400" : ""
                        }
                      >
                        {money(remainingOf(h))} remaining
                      </span>
                    </p>
                  )}

                  {contributorsLoading ? (
                    <Loading label={c("recode.loading.billsAndTime")} />
                  ) : contributorsError ? (
                    <Banner tone="error">{contributorsError}</Banner>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <SectionLabel className="mb-1.5">Bills ({drillBills.length})</SectionLabel>
                        {drillBills.length === 0 ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            No bills coded to this code.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {drillBills.map((b) => (
                              <li
                                key={b.key}
                                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs dark:border-neutral-800"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-medium">{b.vendor}</span>
                                  {b.lineName && b.lineName !== b.vendor ? ` · ${b.lineName}` : ""}
                                  <span className="ml-1 text-neutral-500 dark:text-neutral-400">
                                    {b.issueDate ?? ""}
                                    {b.draft
                                      ? " · draft, not yet synced"
                                      : b.status
                                        ? ` · ${b.status}`
                                        : ""}
                                  </span>
                                </span>
                                <span className="shrink-0 tabular-nums font-semibold">
                                  {money(b.cost)}
                                </span>
                                {!b.draft && (
                                  <JtLink
                                    href={`https://app.jobtread.com/jobs/${jobId}/documents/${b.docId}`}
                                    className="-my-2 inline-flex min-h-11 shrink-0 items-center px-1 font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
                                  >
                                    JT ↗
                                  </JtLink>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <SectionLabel className="mb-1.5">
                          Time entries ({drillTime.length})
                        </SectionLabel>
                        {drillTime.length === 0 ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            No time logged to this code.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {drillTime.map((t) => (
                              <li
                                key={t.id}
                                className="rounded-lg border border-line px-2.5 py-2 text-xs dark:border-neutral-800"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate">
                                    <span className="font-medium">{t.employee}</span>
                                    <span className="ml-1 text-neutral-500 dark:text-neutral-400">
                                      {t.startedAt ? t.startedAt.slice(0, 10) : ""}
                                    </span>
                                  </span>
                                  <Chip
                                    tone={t.isApproved ? "success" : "warning"}
                                    className="shrink-0"
                                    title={
                                      t.isApproved
                                        ? "This time entry is approved in JobTread"
                                        : "This time entry is not yet approved in JobTread"
                                    }
                                  >
                                    {t.isApproved ? "approved" : "unapproved"}
                                  </Chip>
                                  {/* Hours read alongside the amount they cost —
                                      "1.0h · $85" — matching the Labor list. */}
                                  <span className="shrink-0 tabular-nums font-semibold">
                                    {t.hours.toFixed(1)}h · {money(t.cost)}
                                  </span>
                                </div>
                                {/* Same treatment as the "Labor" block's
                                    entries — the note is what the crew typed
                                    about the hours, so it wraps in full rather
                                    than truncating. Reaching an entry by cost
                                    code shouldn't show less than reaching it
                                    down the bills list. */}
                                {t.notes && (
                                  <p className="mt-0.5 whitespace-pre-line text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
                                    {t.notes}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </Card>
        </div>
      )}

    </>
  );
}
