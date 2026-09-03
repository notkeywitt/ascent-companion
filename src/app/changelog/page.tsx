/**
 * Changelog — what each Claude session changed, and what is still in flight.
 *
 * The phone-readable half of the session ledger. The record itself is one
 * markdown file per session under `.claude/sessions/`, written as the work
 * happens (`.githooks/post-commit`); `scripts/session.mjs board --write` folds
 * every one of them into `sessionLog.generated.json`, which this page imports.
 *
 * Why an import and not a read: the deployed bundle cannot open
 * `.claude/sessions/` — Next.js only ships files it can trace — so the ledger
 * travels as data, committed alongside the work it describes. That also fixes
 * the freshness rule in the only honest place: this page shows what has been
 * PUSHED. A session still running on a branch is not here yet, and saying so
 * on the page is cheaper than pretending otherwise.
 *
 * A pure server component on purpose. There is nothing to interact with beyond
 * expanding a session, which `<details>` does with no JavaScript at all — so
 * the page costs one HTML response and works before hydration.
 */
import type { Metadata } from "next";

import {
  Card,
  Chip,
  MetaLine,
  PageHeader,
  SectionHeading,
  StatementBlock,
} from "@/components/ui";
import ledger from "@/lib/sessionLog.generated.json";

export const metadata: Metadata = { title: "Changelog" };

interface Commit {
  date: string;
  time: string;
  sha: string;
  subject: string;
  files: string;
}
interface Session {
  slug: string;
  file: string;
  branch: string;
  status: string;
  started: string;
  updated: string;
  goal: string;
  next: string;
  commits: Commit[];
}

const SESSIONS = ledger.sessions as Session[];

// Pacific, always. The server renders in UTC and the office reads in Pacific;
// naming the zone is what keeps a late-evening commit from showing tomorrow's
// date. (No hydration risk either way — nothing here runs in the browser.)
const TZ = "America/Los_Angeles";

/** "Sep 3" — a commit's own date string, which is already local to the commit. */
function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Sep 3, 2026" from a stored ISO stamp. */
function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: TZ,
  });
}

function daysAgo(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** "3d ago", "today" — the quiet half of a MetaLine, never the loud half. */
function fromNow(iso: string): string {
  const d = daysAgo(iso);
  if (d === null) return "";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return longDate(iso);
}

const STATUS_TONE = {
  "in-progress": "info",
  parked: "warning",
  shipped: "neutral",
} as const;

function statusTone(status: string) {
  return STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral";
}

/**
 * One session, as a row that opens.
 *
 * Closed it is a headline: what the session set out to do, and where it got to.
 * Open it is the commit log the post-commit hook wrote — which is the part that
 * answers "what actually changed" without opening a terminal.
 */
function SessionRow({ session }: { session: Session }) {
  const title = session.goal || session.slug;
  const n = session.commits.length;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 marker:hidden hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug tracking-tight">{title}</span>
          <MetaLine
            className="mt-1"
            items={[
              session.status === "shipped" ? null : (
                <Chip key="s" tone={statusTone(session.status)}>
                  {session.status === "in-progress" ? "in flight" : session.status}
                </Chip>
              ),
              `${n} ${n === 1 ? "change" : "changes"}`,
              fromNow(session.updated),
            ]}
          />
          {session.next && session.status !== "shipped" && (
            <span className="mt-1.5 block border-l-2 border-line pl-2.5 text-[11.5px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Next: {session.next}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className="mt-0.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>

      <div className="border-t border-line-soft bg-neutral-50/60 px-4 py-3 dark:bg-neutral-800/30">
        {n === 0 ? (
          <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
            No commits recorded yet.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {session.commits.map((c) => (
              <li key={c.sha}>
                <p className="text-[12.5px] leading-snug">{c.subject}</p>
                <MetaLine
                  className="mt-0.5"
                  items={[
                    <span key="sha" className="font-mono">
                      {c.sha}
                    </span>,
                    shortDate(c.date),
                    c.files || null,
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function SessionList({ sessions }: { sessions: Session[] }) {
  return (
    <Card pad={false} className="mt-2.5 divide-y divide-line-soft overflow-hidden">
      {sessions.map((s) => (
        <SessionRow key={s.file} session={s} />
      ))}
    </Card>
  );
}

export default function ChangelogPage() {
  const open = SESSIONS.filter((s) => s.status === "in-progress");
  const parked = SESSIONS.filter((s) => s.status === "parked");
  const shipped = SESSIONS.filter((s) => s.status === "shipped");

  // The one display figure: how much reached the app recently. Counted in
  // changes rather than sessions, because a session is an hour of someone's
  // attention and a change is a thing the app now does.
  const recent = shipped.filter((s) => (daysAgo(s.updated) ?? 999) <= 30);
  const recentChanges = recent.reduce((n, s) => n + s.commits.length, 0);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Changelog"
        description="What each working session changed, and what is still unfinished. Written as the work happens, so an interrupted session still leaves a record."
      />

      <StatementBlock
        label="Shipped · last 30 days"
        value={recentChanges}
        sub={`${recent.length} ${recent.length === 1 ? "session" : "sessions"}${
          shipped.length ? ` · ${shipped.length} shipped in all` : ""
        }`}
        footnote="Only pushed work appears here. A session still running on a branch shows up when it ships."
      />

      {open.length > 0 && (
        <section className="mt-8">
          <SectionHeading>In flight</SectionHeading>
          <SessionList sessions={open} />
        </section>
      )}

      {parked.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Parked</SectionHeading>
          <SessionList sessions={parked} />
        </section>
      )}

      <section className="mt-8">
        <SectionHeading>Shipped</SectionHeading>
        {shipped.length === 0 ? (
          <p className="mt-2.5 text-sm text-neutral-500 dark:text-neutral-400">
            Nothing shipped yet.
          </p>
        ) : (
          <SessionList sessions={shipped} />
        )}
      </section>

      <p className="mt-8 text-[11.5px] text-neutral-500 dark:text-neutral-400">
        Updated {longDate(ledger.generatedAt)}. The back end keeps its own record
        in <span className="font-mono">ascent-appscript/SESSIONS.md</span>.
      </p>
    </main>
  );
}
