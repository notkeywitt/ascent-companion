"use client";

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
 * jobs, then PreCon jobs, then the leads. A job card answers three questions
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
          className="block text-[12.5px] font-semibold leading-snug hover:text-accent dark:hover:text-accent-soft"
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
      {t.due && <MetaLine items={[`due ${shortDate(t.due)}`]} />}
    </li>
  );
}

function JobCard({ c }: { c: JobsPageCard }) {
  return (
    // `w-72` is the SCROLLER's card; from `pad` up the row is a grid and the
    // cell sets the width (`pad:w-auto` is emitted after the bare width).
    <Card className="flex h-full w-72 shrink-0 flex-col gap-2 pad:w-auto">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <a
            href={jtJobUrl(c.id)}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight hover:text-accent dark:hover:text-accent-soft"
          >
            {c.name}
          </a>
          {c.number && (
            <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">#{c.number}</span>
          )}
        </div>
        <div className="truncate text-[12px] text-neutral-700 dark:text-neutral-300">
          {c.customer || "No customer"}
        </div>
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
    </Card>
  );
}

/** One titled row of job cards. */
function JobRow({ title, cards, empty }: { title: string; cards: JobsPageCard[]; empty: string }) {
  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        trailing={<span className="text-[11px] tabular-nums text-neutral-500">{cards.length}</span>}
      >
        {title}
      </SectionHeading>
      {cards.length === 0 ? (
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
        else setBoard({ active: j.active ?? [], precon: j.precon ?? [] });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the jobs.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-5 pad:max-w-none pad:px-7 xl:px-8">
      <PageHeader
        title="Jobs"
        description="Active jobs, PreCon jobs and leads — the schedule now and the newest to-dos."
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
    </main>
  );
}
