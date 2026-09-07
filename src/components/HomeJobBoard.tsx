"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, MetaLine, SectionHeading, Meter, Skeleton } from "@/components/ui";
import { Donut, type DonutSlice } from "@/components/Donut";
import { useAccess } from "@/components/AccessProvider";
import {
  dateRange,
  scheduleHeadline,
  scheduleMeta,
  shortDate,
  spentOf,
  type JobBoardCard,
} from "@/lib/jobBoard";

/**
 * The job board at the top of the home page — budget status and calendar
 * position for the work in flight, so the first screen of the day answers
 * "where is every job" before anyone opens a page.
 *
 * TWO SHAPES, ONE COMPONENT, and the SERVER picks which (see
 * /api/home/board/route.ts): office and admin get a card per active job in a
 * row that scrolls sideways — kanban-style, widest on a desktop screen; a lead
 * gets ONE full-width panel for the job they last logged time to. A field phone
 * never asks.
 *
 * Self-hiding, like the banners it sits with: no cards, no board, no heading.
 * The board is READ-ONLY — one cached JobTread roll-up (getJobBoard) behind one
 * fetch, no writes anywhere in this path.
 */

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * The budget donut: spent against budget, with the overrun as its own red
 * slice when there is one. Two slices, never more — the question is "how much
 * of the budget is gone", not "on what" (the /jobs browser's rings answer
 * that, by CSI division).
 */
function budgetSlices(c: JobBoardCard): DonutSlice[] {
  const spent = spentOf(c);
  if (c.budget <= 0) {
    return spent > 0
      ? [{ key: "spent", label: "Spent (no budget set)", value: spent, color: "var(--viz-8)" }]
      : [];
  }
  const over = spent - c.budget;
  if (over > 0) {
    return [
      { key: "budget", label: "Budget", value: c.budget, color: "rgb(var(--accent))" },
      { key: "over", label: "Over budget", value: over, color: "var(--viz-8)" },
    ];
  }
  return [
    { key: "spent", label: "Spent", value: spent, color: "rgb(var(--accent))" },
    { key: "left", label: "Remaining", value: c.budget - spent, color: "var(--viz-other)" },
  ];
}

/** Share of budget spent, as the donut's centre readout. */
const usedPct = (c: JobBoardCard) =>
  c.budget > 0 ? `${Math.round((spentOf(c) / c.budget) * 100)}%` : "—";

/** "budget from the base estimate" is worth saying; a normal budget is not. */
const basisNote = (c: JobBoardCard) =>
  c.budgetBasis === "leaves"
    ? "budget from estimate"
    : c.budgetBasis === "none"
      ? "no budget set"
      : "";

/** Every card opens that job's tracking sheet — the page these numbers live on. */
function JobCardLink({
  c,
  className = "block",
  children,
}: {
  c: JobBoardCard;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={`/trackingsheet?jobId=${encodeURIComponent(c.id)}`} className={className}>
      {children}
    </Link>
  );
}

/** One job, as a board card. */
function BoardCard({ c }: { c: JobBoardCard }) {
  return (
    <JobCardLink c={c} className="block w-72 shrink-0">
      <Card className="flex h-full flex-col gap-2 transition hover:border-accent">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{c.name}</div>
          <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {c.customer || "—"}
          </div>
        </div>
        <Donut
          slices={budgetSlices(c)}
          size={104}
          centerValue={usedPct(c)}
          centerLabel="of budget"
          emptyLabel="No budget"
        />
        <div className="mt-auto border-t border-line-soft pt-2">
          <div
            className="truncate text-[12.5px] font-semibold"
            title={scheduleHeadline(c.schedule)}
          >
            {scheduleHeadline(c.schedule)}
          </div>
          <MetaLine items={[...scheduleMeta(c.schedule), basisNote(c)]} />
        </div>
      </Card>
    </JobCardLink>
  );
}

/** A lead's own job, across the full width: the same numbers, room to spell out. */
function LeadPanel({ c }: { c: JobBoardCard }) {
  const spent = spentOf(c);
  const s = c.schedule;
  return (
    <JobCardLink c={c}>
      <Card className="transition hover:border-accent">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Donut
            slices={budgetSlices(c)}
            size={120}
            centerValue={usedPct(c)}
            centerLabel="of budget"
            emptyLabel="No budget"
          />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold tracking-tight">{c.name}</div>
            <MetaLine items={[c.customer, basisNote(c)]} className="mt-0.5" />

            <div className="mt-3 flex items-baseline justify-between text-[12.5px]">
              <span className="font-semibold">{money0(spent)} spent</span>
              <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                of {money0(c.budget)}
              </span>
            </div>
            <Meter budget={c.budget} used={spent} label={c.name} className="mt-1 h-1.5" />
            <MetaLine
              className="mt-1"
              items={[`${money0(c.bills)} bills`, `${money0(c.labor)} labor`]}
            />

            <div className="mt-3 border-t border-line-soft pt-2">
              <div className="text-[12.5px] font-semibold">{scheduleHeadline(s)}</div>
              <MetaLine items={scheduleMeta(s)} />
              {/* Everything else on the calendar today, then what starts next —
                  a lead's "what am I on" is the whole open window, not one bar. */}
              {s && s.now.length > 1 && (
                <ul className="mt-2 space-y-0.5">
                  {s.now.slice(1).map((t) => (
                    <li
                      key={`${t.name}${t.start}`}
                      className="flex justify-between gap-3 text-[11.5px]"
                    >
                      <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">
                        {t.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-neutral-500">{dateRange(t)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s?.next && s.now.length > 0 && (
                <p className="mt-2 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                  Next: {s.next.name} · starts {shortDate(s.next.start)}
                </p>
              )}
            </div>
          </div>
        </div>
      </Card>
    </JobCardLink>
  );
}

export function HomeJobBoard() {
  const access = useAccess();
  const [cards, setCards] = useState<JobBoardCard[] | null>(null);

  useEffect(() => {
    if (access.role === "field") return; // nothing for this role — don't even ask
    let cancelled = false;
    fetch("/api/home/board")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setCards(j.error ? [] : (j.cards ?? []));
      })
      .catch(() => {
        if (!cancelled) setCards([]); // a board that can't load just isn't there
      });
    return () => {
      cancelled = true;
    };
  }, [access.role]);

  if (access.role === "field") return null;
  if (cards === null) {
    return (
      <div className="mb-6">
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (cards.length === 0) return null;

  const lead = access.role === "lead";
  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        trailing={
          lead ? undefined : (
            <span className="text-[11px] tabular-nums text-neutral-500">{cards.length}</span>
          )
        }
      >
        {lead ? "Your job" : "Active jobs"}
      </SectionHeading>
      {lead ? (
        <LeadPanel c={cards[0]} />
      ) : (
        // The row bleeds to the page's edges so the next card is visibly cut
        // off — the same trick ChipScroller uses to say "there is more".
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 xl:-mx-8 xl:px-8">
          {cards.map((c) => (
            <BoardCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </section>
  );
}
