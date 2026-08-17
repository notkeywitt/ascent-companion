"use client";

import Link from "next/link";
import {
  Button,
  Card,
  Chip,
  ListCard,
  ListRow,
  Meter,
  PageHeader,
  SectionHeading,
  btn,
} from "@/components/ui";
import {
  FAST_PATH,
  SEGMENTS,
  TOTAL,
  UNITS,
  getSegment,
  nextReady,
  segmentsInUnit,
} from "@/lib/course";
import { useCourseProgress } from "@/lib/useCourseProgress";

/**
 * The course home: the syllabus grouped by unit, a "pick up where you left off"
 * card, and per-segment progress marks. All progress is read from the browser
 * (see useCourseProgress) so the page renders a neutral state on the server and
 * fills in once hydrated.
 */
export function CourseHome() {
  const p = useCourseProgress();

  const doneCount = p.done.length;
  const last = p.last;
  const lastMeta = last ? getSegment(last) : undefined;
  const lastPct = last ? Math.round(p.posOf(last) * 100) : 0;
  const resuming =
    p.hydrated && lastMeta && lastMeta.ready && !p.isDone(last!) && lastPct >= 3 && lastPct < 97;
  const next = nextReady(p.done);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Course"
        description="Reading Your Own App — a guided walk through this codebase, written for you, not for a developer."
      />

      {/* Overall progress + resume / start */}
      {resuming ? (
        <Card className="mb-6 border-l-2 border-l-accent">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Pick up where you left off
          </p>
          <p className="mt-1 text-base font-bold tracking-tight">
            Segment {last} — {lastMeta!.title}
          </p>
          <Meter budget={100} used={lastPct} label="reading" className="mt-2 h-1.5" />
          <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            {lastPct}% through · {doneCount} of {TOTAL} segments complete
          </p>
          {/* scroll={false}: the reader scrolls to the saved spot itself, so
              suppress App Router's scroll-to-top or the two fight. */}
          <Link
            href={`/course/${last}?resume=1`}
            scroll={false}
            className={btn("primary", "md", "mt-3 w-full")}
          >
            Resume reading
          </Link>
        </Card>
      ) : (
        <Card className="mb-6">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            {doneCount === 0
              ? "Nothing read yet. Segment 1 takes about 40 minutes and is the one that makes the other eleven navigable."
              : next
                ? `${doneCount} of ${TOTAL} segments complete. Segment ${next} is next.`
                : "Everything written so far is complete — more segments are on the way."}
          </p>
          {doneCount > 0 && (
            <Meter budget={TOTAL} used={doneCount} label="course" className="mt-3 h-1.5" />
          )}
          <Link
            href={`/course/${next ?? 1}`}
            className={btn(doneCount === 0 ? "primary" : "outline", "md", "mt-3 w-full")}
          >
            {doneCount === 0 ? "Start Segment 1" : next ? `Continue with Segment ${next}` : "Re-read Segment 1"}
          </Link>
        </Card>
      )}

      {/* Syllabus, grouped by unit */}
      <div className="space-y-6">
        {UNITS.map((unit) => (
          <section key={unit} className="space-y-2.5">
            <SectionHeading>{unit}</SectionHeading>
            <ListCard>
              {segmentsInUnit(unit).map((s) => {
                const done = p.hydrated && p.isDone(s.n);
                const pct = p.hydrated ? Math.round(p.posOf(s.n) * 100) : 0;
                const started = pct >= 3 && !done;
                const badge = !s.ready ? (
                  <Chip tone="neutral">Soon</Chip>
                ) : done ? (
                  <Chip tone="success">Done</Chip>
                ) : started ? (
                  <Chip tone="accent">{pct}%</Chip>
                ) : (
                  <Chip tone="neutral">{s.minutes} min</Chip>
                );
                const label = (
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-neutral-400">
                      {String(s.n).padStart(2, "0")}
                    </span>
                    <span>{s.title}</span>
                  </span>
                );
                return s.ready ? (
                  <ListRow
                    key={s.n}
                    href={`/course/${s.n}`}
                    label={label}
                    desc={s.question}
                    badge={badge}
                  />
                ) : (
                  <ListRow
                    key={s.n}
                    label={<span className="opacity-55">{label}</span>}
                    desc={<span className="opacity-55">{s.question}</span>}
                    badge={badge}
                    chevron={false}
                  />
                );
              })}
            </ListCard>
          </section>
        ))}
      </div>

      {/* Fast path + housekeeping */}
      <Card className="mt-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          If you want the fast path
        </p>
        <p className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-300">
          Segments {FAST_PATH.slice(0, -1).join(", ")} and {FAST_PATH[FAST_PATH.length - 1]} are the
          core. Those six get you to &ldquo;I understand what this program does and what&rsquo;s risky
          about it.&rdquo; The rest add depth on the parts you touch most.
        </p>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-3 text-xs text-neutral-400">
        <span>Source of record: docs/course/ · progress is saved on this device.</span>
        {p.hydrated && (doneCount > 0 || last) && (
          <Button variant="ghost" size="sm" onClick={p.reset} className="shrink-0">
            Reset progress
          </Button>
        )}
      </div>
    </main>
  );
}
