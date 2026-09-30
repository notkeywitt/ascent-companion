"use client";

import type { Dispatch, SetStateAction } from "react";
import type { useRouter } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { remainingOf, type Headroom } from "./headroom";
import { money0 } from "./BillCodingCard";
import { driveMainWindowToDoc } from "@/components/BillingSummary";
import type { JobBillLine } from "./Board";

/**
 * The Tracking Sheets board's By cost code view: the month's lines grouped
 * into one lane per code. It is the drag surface — a line or bill stack
 * dragged onto another lane stages a recode (see `useLineDrag`).
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * markup is the board's, unchanged.
 */
export function CodeLanesView({
  beginDrag,
  belowXl,
  c,
  dragLineIds,
  dragOverCode,
  dropHandlers,
  endDrag,
  jobId,
  laneRows,
  mode,
  router,
  setOpenDocId,
  setOpenTimeId,
  staged,
  ym,
}: {
  beginDrag: (lineIds: string[]) => (e: React.DragEvent) => void;
  belowXl: boolean;
  c: (key: string, vars?: Record<string, string | number>) => string;
  dragLineIds: string[] | null;
  dragOverCode: string | null;
  dropHandlers: (code: string, droppable: boolean) => { onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void; } | { onDragOver?: undefined; onDragLeave?: undefined; onDrop?: undefined; };
  endDrag: () => void;
  jobId: string;
  laneRows: { code: string; h: Headroom | undefined; stacks: { key: string; docId: string; lines: JobBillLine[]; cost: number; label: string; status: string; invoiced: boolean; }[]; total: number; }[];
  mode: "bill" | "code" | "summary";
  router: ReturnType<typeof useRouter>;
  setOpenDocId: Dispatch<SetStateAction<string | null>>;
  setOpenTimeId: Dispatch<SetStateAction<string | null>>;
  staged: Map<string, string>;
  ym: string;
}) {
  return (
    <>
            {/* ---- grouped by cost code: the drag surface ---- */}
            {mode === "code" &&
              (laneRows.length === 0 ? (
                <EmptyState>{c("recode.empty.noCodedLines")}</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {laneRows.map(({ code, h, stacks, total }) => (
                    <li key={code}>
                      <Card
                        pad={false}
                        {...dropHandlers(code, h?.droppable ?? false)}
                        className={`transition ${
                          dragOverCode === code ? "ring-2 ring-accent" : ""
                        } ${dragLineIds && !h?.droppable ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-2 border-b border-line-soft px-3 py-2 dark:border-neutral-800">
                          <span className="min-w-0 truncate">
                            <span className="text-xs tabular-nums text-neutral-500">{code}</span>{" "}
                            <span className="text-sm font-semibold">{h?.name ?? ""}</span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums">
                            {money0(total)} here ·{" "}
                            <span
                              className={
                                h && remainingOf(h) < 0
                                  ? "font-semibold text-red-600 dark:text-red-400"
                                  : "text-neutral-500"
                              }
                            >
                              {h ? money0(remainingOf(h)) : "—"} left
                            </span>
                          </span>
                        </div>
                        <ul className="flex flex-wrap gap-1.5 p-2">
                          {stacks.map((s) => {
                            const moved = s.lines.some((l) => staged.has(l.id));
                            return (
                              <li key={s.key}>
                                <div
                                  draggable={!s.invoiced}
                                  onDragStart={beginDrag(s.lines.map((l) => l.id))}
                                  onDragEnd={endDrag}
                                  // Same rule the bill list follows: on a phone
                                  // the coding drawer is hidden, so setOpenDocId
                                  // would open nothing and the tap would read as
                                  // dead. Send it to the bill's detail page
                                  // instead, carrying the same back-context.
                                  onClick={() => {
                                    // In the Chrome side panel this app runs in
                                    // an iframe beside a JobTread tab; opening a
                                    // bill here drives that window to the same
                                    // document. No-op when unframed.
                                    driveMainWindowToDoc(jobId, s.docId);
                                    // Same rule as the bill list — see there.
                                    if (belowXl) {
                                      router.push(
                                        `/bill/${s.docId}?jobId=${encodeURIComponent(jobId)}` +
                                          `&from=recode&ym=${encodeURIComponent(ym)}`,
                                      );
                                    } else {
                                      // The coding column shows one thing —
                                      // claiming it for a bill releases the
                                      // time entry that had it.
                                      setOpenTimeId(null);
                                      setOpenDocId(s.docId);
                                    }
                                  }}
                                  title={s.lines.map((l) => l.name).join("\n")}
                                  className={`rounded-md border px-2 py-1.5 text-[11px] transition lg:py-1 ${
                                    s.invoiced ? "" : "cursor-grab active:cursor-grabbing"
                                  } ${
                                    moved
                                      ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                                      : "border-line bg-white hover:border-accent dark:border-neutral-700 dark:bg-ink-overlay"
                                  }`}
                                >
                                  <span className="block max-w-[16rem] truncate font-medium">
                                    {s.label}
                                    {/* Several lines of ONE bill in one lane stack into a single chip. */}
                                    {s.lines.length > 1 && (
                                      <span className="ml-1 rounded bg-neutral-200 px-1 text-[10px] tabular-nums dark:bg-neutral-700">
                                        ×{s.lines.length}
                                      </span>
                                    )}
                                  </span>
                                  <span className="block tabular-nums text-neutral-500">
                                    {money0(s.cost)}
                                    {s.status === "draft" && " · draft"}
                                    {s.invoiced && " · invoiced"}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </Card>
                    </li>
                  ))}
                </ul>
              ))}

    </>
  );
}
