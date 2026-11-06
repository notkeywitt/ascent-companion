"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Banner,
  Card,
  EmptyState,
  MetaLine,
  PageHeader,
  SectionHeading,
  Skeleton,
} from "@/components/ui";
import { HomeLeadBoard } from "@/components/HomeLeadBoard";
import { jtJobUrl, jtScheduleUrl, jtToDoUrl } from "@/lib/jtLinks";
import {
  dateRange,
  scheduleHeadline,
  shortDate,
  type JobsPageCard,
  type JobToDo,
} from "@/lib/jobBoard";

/**
 * The Jobs page — every job the office is carrying, as kanban rows: Active
 * jobs, then PreCon jobs, then the leads, then Complete jobs (folded, since the
 * row only grows). A job card answers three questions
 * without opening JobTread: whose job and where, what is on the schedule now,
 * and the three newest open to-dos. Every line links into JobTread. Nothing
 * here writes.
 *
 * The leads row is the home page's lead board (HomeLeadBoard), so the two
 * pages cannot disagree about a lead.
 */

interface Board {
  active: JobsPageCard[];
  precon: JobsPageCard[];
  complete: JobsPageCard[];
}

/** A small caption over a card's block. */
const BlockLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
    {children}
  </div>
);

/** The schedule entry that covers today, or the next one to start. */
function ScheduleNow({ c }: { c: JobsPageCard }) {
  const s = c.schedule;
  const lead = s ? (s.now[0] ?? s.next) : null;
  // The widest bar covering today is the Gantt phase the leaf sits under.
  const phase = s && s.now.length > 1 ? s.now[s.now.length - 1].name : null;
  return (
    <div className="border-t border-line-soft pt-2">
      <BlockLabel>Schedule</BlockLabel>
      {s ? (
        <a
          href={jtScheduleUrl(c.id)}
          target="_blank"
          rel="noreferrer"
          className="block text-[13px] font-semibold leading-snug hover:text-accent dark:hover:text-accent-soft"
        >
          {scheduleHeadline(s)}
        </a>
      ) : (
        <p className="text-[12px] italic text-neutral-500">No schedule in JobTread</p>
      )}
      {lead && <MetaLine items={[dateRange(lead), phase]} />}
    </div>
  );
}

function ToDoLine({ t }: { t: JobToDo }) {
  return (
    <li>
      <a
        href={jtToDoUrl(t.id)}
        target="_blank"
        rel="noreferrer"
        className="line-clamp-2 text-[12px] font-medium leading-snug hover:text-accent dark:hover:text-accent-soft"
      >
        {t.name}
      </a>
      <MetaLine
        items={[t.due ? `due ${shortDate(t.due)}` : null, t.assignees.join(", ") || null]}
      />
    </li>
  );
}

/** `aside` sits in the card's right column — the Jobs page's to-be-invoiced
 *  figure (owner, 2026-11-01). `footer` is a row of its own across the foot of
 *  the card, centred — the Jobs page's tabs, clear of the job's text (owner,
 *  2026-11-02). */
export function JobCard({
  c,
  aside,
  footer,
  onCustomer,
  nameLink = true,
}: {
  /** False: the name is plain text, not a link to the job's page (the Jobs
   *  page's card, which already is that page — owner, 2026-11-02). */
  nameLink?: boolean;
  c: JobsPageCard;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  /** Makes the customer name a button (the Jobs page's customer pop-up). */
  onCustomer?: () => void;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {/* The name opens the job's own pages (record, cost, specs …) through
              the job tab row (stage 4); the number and JobTread's ↗ sit right
              beside it (owner, 2026-11-02). */}
          {nameLink ? (
            <Link
              href={`/job-board/${encodeURIComponent(c.id)}`}
              className="min-w-0 truncate text-sm font-semibold tracking-tight hover:text-accent dark:hover:text-accent-soft"
            >
              {c.name}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-sm font-semibold tracking-tight">{c.name}</span>
          )}
          {c.number && (
            <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">#{c.number}</span>
          )}
          <a
            href={jtJobUrl(c.id)}
            target="_blank"
            rel="noreferrer"
            aria-label={`${c.name} in JobTread`}
            className="shrink-0 text-[11px] font-semibold text-neutral-500 hover:text-accent dark:text-neutral-400"
          >
            JT ↗
          </a>
        </div>
        {onCustomer && c.customer ? (
          <button
            type="button"
            onClick={onCustomer}
            className="block max-w-full truncate text-left text-[12px] text-neutral-700 hover:text-accent dark:text-neutral-300 dark:hover:text-accent-soft"
          >
            {c.customer}
          </button>
        ) : (
          <div className="truncate text-[12px] text-neutral-700 dark:text-neutral-300">
            {c.customer || "No customer"}
          </div>
        )}
        {/* Two lines: a rural San Juan County address wraps, and one line loses the road. */}
        <div className="line-clamp-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          {c.address || "No address in JobTread"}
        </div>
      </div>

      <ScheduleNow c={c} />

      <div className="mt-auto border-t border-line-soft pt-2">
        <BlockLabel>To-dos</BlockLabel>
        {c.todos.length > 0 ? (
          <ul className="mt-0.5 space-y-1.5">
            {c.todos.map((t) => (
              <ToDoLine key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <p className="text-[12px] italic text-neutral-500">No open to-dos</p>
        )}
      </div>
    </>
  );
  return (
    // `w-72` is the SCROLLER's card; from `pad` up the row is a grid and the
    // cell sets the width (`pad:w-auto` is emitted after the bare width). The
    // Jobs page's card (`aside`) is no scroller card: it spans the screen.
    <Card
      className={`flex h-full shrink-0 flex-col gap-2 ${aside ? "min-h-0 w-full overflow-hidden" : "w-72 pad:w-auto"}`}
    >
      {aside ? (
        // A phone stacks the aside under the job: beside it, the aside's
        // rings ran off the card's right edge (owner, 2026-11-03).
        <div className="flex min-h-0 flex-1 flex-col gap-4 pad:flex-row">
          {/* Scrolls when the card is held to a height (the Jobs page). */}
          {/* The details hold a fixed width so the aside cannot squeeze them
              (owner, 2026-11-06); the aside takes the rest. */}
          <div className="no-scrollbar flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto pad:w-56 pad:shrink-0">{body}</div>
          <div className="min-w-0 flex-1 pad:h-full">{aside}</div>
        </div>
      ) : (
        body
      )}
      {footer && (
        <div className="flex shrink-0 justify-center border-t border-line-soft pt-3">{footer}</div>
      )}
    </Card>
  );
}

/** One titled row of job cards. */
function JobRow({
  title,
  cards,
  empty,
  foldable = false,
}: {
  title: string;
  cards: JobsPageCard[];
  empty: string;
  /** Starts folded; the heading shows and hides the row. */
  foldable?: boolean;
}) {
  const [open, setOpen] = useState(!foldable);
  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        trailing={<span className="text-[11px] tabular-nums text-neutral-500">{cards.length}</span>}
        onToggle={foldable ? () => setOpen((o) => !o) : undefined}
        open={open}
      >
        {title}
      </SectionHeading>
      {!open ? null : cards.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        // Phone: a sideways row that bleeds to the screen edges, so the next
        // card is visibly cut off. From `pad` up: a grid, the same steps as the
        // home page's boards.
        <div className="-mx-4 flex items-stretch gap-3 overflow-x-auto px-4 pb-1 pad:mx-0 pad:grid pad:grid-cols-2 pad:overflow-x-visible pad:px-0 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((c) => (
            <JobCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </section>
  );
}

export function JobBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/job-board")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) setError(j.error);
        else setBoard({ active: j.active ?? [], precon: j.precon ?? [], complete: j.complete ?? [] });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the jobs.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="w-full max-w-2xl px-4 pb-10 pt-5 pad:max-w-none pad:px-7">
      <PageHeader
        title="Job Board"
        description="Active jobs, PreCon jobs, leads and complete jobs — the schedule now and the newest to-dos."
      />

      {error && (
        <Banner tone="error" className="mb-6">
          {error}
        </Banner>
      )}

      {!board && !error && (
        <div className="mb-6 space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      )}

      {board && (
        <>
          <JobRow
            title="Active jobs"
            cards={board.active}
            empty="No job has Phase set to Active."
          />
          <JobRow
            title="PreCon jobs"
            cards={board.precon}
            empty="No job has Phase set to PreCon."
          />
        </>
      )}

      {/* Self-gating on the `leads` view; folds and orders per device, kept
          apart from the home page's copy by `storeAs`. */}
      <HomeLeadBoard storeAs="jobs" />

      {board && (
        <JobRow
          title="Complete"
          cards={board.complete}
          empty="No job has Phase set to Complete."
          foldable
        />
      )}
    </main>
  );
}
