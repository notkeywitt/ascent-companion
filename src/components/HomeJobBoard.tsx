"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  Loading,
  Meter,
  MetaLine,
  SectionHeading,
  Skeleton,
  StatementBlock,
} from "@/components/ui";
import { Donut, type DonutSlice } from "@/components/Donut";
import { JobGantt } from "@/components/JobGantt";
import { jtBudgetUrl } from "@/lib/jtLinks";
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
 * DRILL DOWN. The CARD is a link to the job's tracking sheet — clicking it goes
 * there, the way it reads. The drilldown is its own toggle LINE at the foot of
 * the card ("Cost by division"), the same gesture as every other collapsing
 * element in the app, and it opens the job's cost by CSI division under the row:
 * the numbers the /jobs browser's table is built on, from the same cached route
 * (/api/jobs/cost-detail), fetched only when someone actually opens one. One
 * level deep on purpose — below division sits cost code and then the estimate
 * line, and that is the Tracking Sheet's job. The open panel also draws the
 * job's Gantt chart (JobGantt), which is the same schedule the card summarises
 * in one line, with every phase and today's position on it.
 *
 * Self-hiding, like the banners it sits with: no cards, no board, no heading.
 * The board is READ-ONLY — one cached JobTread roll-up (getJobBoard) behind one
 * fetch, no writes anywhere in this path.
 */

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/* ------------------------------------------------------------ cost detail */

/**
 * Only the fields the drilldown reads, out of /api/jobs/cost-detail's tree —
 * declared locally, the same way JobsBrowser declares its own view of it, so
 * this component pulls nothing server-side into the bundle.
 */
interface DivisionRow {
  division: string;
  name: string;
  budget: number;
  bills: number;
  labor: number;
  laborHours: number;
}

interface CostDetail {
  divisions: DivisionRow[];
}

/** What the drilldown knows about one job's cost tree right now. */
type DetailState =
  { status: "loading" } | { status: "error" } | { status: "ok"; detail: CostDetail };

/**
 * One job's cost detail, fetched on first open and then kept — a card the
 * office opens, closes and reopens while scanning the row shouldn't re-fetch,
 * and the route is cached server-side anyway.
 */
function useCostDetail(jobId: string | null) {
  const [byJob, setByJob] = useState<Record<string, DetailState>>({});

  useEffect(() => {
    if (!jobId || byJob[jobId]) return;
    let cancelled = false;
    setByJob((m) => ({ ...m, [jobId]: { status: "loading" } }));
    fetch(`/api/jobs/cost-detail?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j: CostDetail & { error?: string }) => {
        if (cancelled) return;
        setByJob((m) => ({
          ...m,
          [jobId]: j.error ? { status: "error" } : { status: "ok", detail: j },
        }));
      })
      .catch(() => {
        if (!cancelled) setByJob((m) => ({ ...m, [jobId]: { status: "error" } }));
      });
    return () => {
      cancelled = true;
    };
    // byJob is deliberately not a dependency: it is the cache this effect writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return jobId ? byJob[jobId] : undefined;
}

/* ----------------------------------------------------------------- pieces */

/**
 * The budget donut: spent against budget, with the overrun as its own red
 * slice when there is one. Two slices, never more — the question is "how much
 * of the budget is gone", not "on what" (the drilldown below answers that, by
 * CSI division).
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

/** The way out of every panel: the page these numbers are actually worked on. */
function TrackingSheetLink({ c }: { c: JobBoardCard }) {
  return (
    <Link
      href={`/trackingsheet?jobId=${encodeURIComponent(c.id)}`}
      className="shrink-0 text-[11.5px] font-semibold text-accent hover:underline dark:text-accent-soft"
    >
      Tracking sheet →
    </Link>
  );
}

/** What is on the JobTread calendar today, and what starts next. */
function ScheduleBlock({ c }: { c: JobBoardCard }) {
  const s = c.schedule;
  return (
    <div>
      <div className="text-[12.5px] font-semibold">{scheduleHeadline(s)}</div>
      <MetaLine items={scheduleMeta(s)} />
      {/* Everything else open on the calendar, then what starts next — "what am
          I on" is the whole open window, not one bar. */}
      {s && s.now.length > 1 && (
        <ul className="mt-2 space-y-0.5">
          {s.now.slice(1).map((t) => (
            <li key={`${t.name}${t.start}`} className="flex justify-between gap-3 text-[11.5px]">
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
  );
}

/**
 * Cost by CSI division, biggest spend first — the drilldown's one table. Each
 * row opens the job's BUDGET in JobTread, which is where a division's codes
 * are; JobTread exposes no confirmed per-code parameter, so the link stops
 * there rather than guessing one (see lib/jtLinks.ts).
 */
function DivisionList({ jobId, detail }: { jobId: string; detail: CostDetail }) {
  const rows = detail.divisions
    .map((d) => ({ ...d, spent: d.bills + d.labor }))
    .filter((d) => d.budget > 0 || d.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  if (rows.length === 0) {
    return (
      <p className="px-3 py-2 text-[11.5px] text-neutral-500 dark:text-neutral-400">
        No coded cost on this job yet.
      </p>
    );
  }
  return (
    <Card pad={false} className="divide-y divide-line-soft">
      {rows.map((d) => {
        const left = d.budget - d.spent;
        return (
          <a
            key={d.division}
            href={jtBudgetUrl(jobId)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold">
                {d.division}
                {d.name ? ` · ${d.name}` : ""}
              </div>
              <Meter budget={d.budget} used={d.spent} label={d.name || d.division} />
              <MetaLine
                items={[
                  d.bills > 0 && `${money0(d.bills)} bills`,
                  d.labor > 0 && `${money0(d.labor)} labor · ${Math.round(d.laborHours)} h`,
                ].filter(Boolean)}
              />
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[12.5px] font-semibold tabular-nums">{money0(d.spent)}</div>
              <div className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                of {money0(d.budget)}
              </div>
              <div
                className={`text-[11px] tabular-nums ${
                  left < 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-neutral-500"
                }`}
              >
                {money0(Math.abs(left))} {left < 0 ? "over" : "left"}
              </div>
            </div>
          </a>
        );
      })}
    </Card>
  );
}

/**
 * The drilldown body: the job's Gantt chart, then its cost by division. Two
 * independent fetches — the chart carries its own (JobGantt), so a slow cost
 * tree never holds up the schedule or the other way round.
 */
function DetailBody({ jobId, state }: { jobId: string; state: DetailState | undefined }) {
  return (
    <div className="space-y-3">
      <JobGantt jobId={jobId} />
      {!state || state.status === "loading" ? (
        <Loading label="Loading cost detail…" />
      ) : state.status === "error" ? (
        <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
          Couldn&apos;t load this job&apos;s cost detail.
        </p>
      ) : (
        <DivisionList jobId={jobId} detail={state.detail} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

/**
 * One job, as a board card. The card itself goes to the tracking sheet; the
 * line at its foot toggles the drilldown, so the two gestures never fight over
 * one click (and a button inside a link would be invalid markup besides).
 */
function BoardCard({
  c,
  expanded,
  onToggle,
}: {
  c: JobBoardCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card
      // `w-72` is the SCROLLER's card. At `pad` the row becomes a grid and the
      // cell decides the width, so the fixed one has to go — `pad:w-auto` is
      // emitted after every unprefixed width, which is what lets it win.
      className={`flex h-full w-72 shrink-0 flex-col gap-2 transition pad:w-auto ${
        expanded ? "border-accent" : ""
      }`}
    >
      <Link
        href={`/trackingsheet?jobId=${encodeURIComponent(c.id)}`}
        className="flex flex-1 flex-col gap-2 rounded-lg transition hover:opacity-80"
      >
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
      </Link>
      <DrilldownToggle open={expanded} onToggle={onToggle} />
    </Card>
  );
}

/**
 * The line that opens the cost drilldown. A row, not a control cluster — the
 * same "tap the label to fold" gesture SectionHeading and the launcher's "show
 * more" row use, with a caret that turns.
 */
function DrilldownToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="-mx-1 flex min-h-9 items-center justify-between gap-2 rounded-lg border-t border-line-soft px-1 pt-2 text-left text-[11.5px] font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
    >
      Schedule & cost by division
      {/* Same mark and rotation SectionHeading uses, so a fold reads the same
          everywhere in the app. */}
      <span
        aria-hidden
        className={`shrink-0 text-[9px] transition-transform ${open ? "rotate-90" : ""}`}
      >
        ▶
      </span>
    </button>
  );
}

/** The opened card, under the row: the job's cost by division, full width. */
function BoardDrilldown({
  c,
  state,
  onClose,
}: {
  c: JobBoardCard;
  state: DetailState | undefined;
  onClose: () => void;
}) {
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{c.name}</div>
          <MetaLine
            items={[
              c.customer,
              `${money0(spentOf(c))} of ${money0(c.budget)}`,
              `${usedPct(c)} of budget`,
              basisNote(c),
            ]}
          />
        </div>
        <TrackingSheetLink c={c} />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-[11.5px] font-semibold text-neutral-500 hover:text-accent"
        >
          Close
        </button>
      </div>
      <ScheduleBlock c={c} />
      <DetailBody jobId={c.id} state={state} />
    </Card>
  );
}

/** A lead's own job, across the full width: the same numbers, room to spell out. */
function LeadPanel({
  c,
  open,
  state,
  onToggle,
}: {
  c: JobBoardCard;
  open: boolean;
  state: DetailState | undefined;
  onToggle: () => void;
}) {
  const spent = spentOf(c);
  return (
    <Card className="space-y-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Donut
          slices={budgetSlices(c)}
          size={120}
          centerValue={usedPct(c)}
          centerLabel="of budget"
          emptyLabel="No budget"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold tracking-tight">{c.name}</div>
              <MetaLine items={[c.customer, basisNote(c)]} className="mt-0.5" />
            </div>
            <TrackingSheetLink c={c} />
          </div>

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
            <ScheduleBlock c={c} />
          </div>
        </div>
      </div>

      <div>
        <DrilldownToggle open={open} onToggle={onToggle} />
        {open && (
          <div className="mt-2">
            <DetailBody jobId={c.id} state={state} />
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Every active job's budget as ONE figure — `pad` and up only.
 *
 * A phone cannot afford this: it already spends its first screen on the card
 * row, and a second number above it would push the first card off. An iPad has
 * the room, and the number is what the row cannot say — the cards each answer
 * "how is THIS job", and nobody adds five donuts up in their head. It is also
 * the one thing on this page readable from across the office, which is where a
 * docked iPad usually is.
 *
 * The page's ONE display figure, so nothing else on home may claim a
 * StatementBlock. `rule={false}` because the section heading above it already
 * drew the band's rule, and two in a row read as a stray divider.
 */
function PortfolioLine({ cards }: { cards: JobBoardCard[] }) {
  const budget = cards.reduce((n, c) => n + c.budget, 0);
  const spent = cards.reduce((n, c) => n + spentOf(c), 0);
  const over = cards.filter((c) => c.budget > 0 && spentOf(c) > c.budget).length;
  const sub = [
    `of ${money0(budget)} across ${cards.length} job${cards.length === 1 ? "" : "s"}`,
    budget > 0 ? `${Math.round((spent / budget) * 100)}% of budget` : null,
    over > 0 ? `${over} over budget` : null,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");

  return (
    <StatementBlock
      rule={false}
      className="mb-1 hidden pad:block"
      label="Spent against budget"
      value={money0(spent)}
      sub={sub}
    />
  );
}

/* ------------------------------------------------------------------ board */

export function HomeJobBoard() {
  const access = useAccess();
  const [cards, setCards] = useState<JobBoardCard[] | null>(null);
  /** Which job is drilled into — one at a time, so the page can't grow legs. */
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useCostDetail(openId);

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
  const open = cards.find((c) => c.id === openId) ?? null;
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

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
        <LeadPanel
          c={cards[0]}
          open={openId === cards[0].id}
          state={detail}
          onToggle={() => toggle(cards[0].id)}
        />
      ) : (
        <>
          <PortfolioLine cards={cards} />
          {/* A PHONE scrolls this row sideways, and it bleeds to the screen
              edges so the next card is visibly cut off — the same trick
              ChipScroller uses to say "there is more".

              AN IPAD DOES NOT. Portrait gives ~1180px of height and ~760px of
              width, so the cards go in a GRID: sideways scrolling hides content
              along the axis a tablet has least of, and it hides it behind a
              gesture rather than behind a scrollbar. Two across in portrait,
              three once the 12.9" portrait width is reached, four on a desktop
              monitor — each step keeps a card near its natural ~300px. */}
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pad:mx-0 pad:grid pad:grid-cols-2 pad:overflow-x-visible pad:px-0 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((c) => (
              <BoardCard
                key={c.id}
                c={c}
                expanded={c.id === openId}
                onToggle={() => toggle(c.id)}
              />
            ))}
          </div>
          {open && <BoardDrilldown c={open} state={detail} onClose={() => setOpenId(null)} />}
        </>
      )}
    </section>
  );
}
