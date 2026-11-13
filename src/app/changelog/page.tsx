/**
 * Changelog — what reached production, newest first.
 *
 * Read from `git log` when the page builds. `force-static` makes that the only
 * time it runs, so each deploy carries the log of the commit it deployed, and
 * the server never shells out at request time. If git is missing or the clone
 * is shallow, the page shows what it could read and says how many.
 *
 * Merge commits are the lander's (scripts/land.sh) and repeat their branch's
 * commits, so they are skipped. So are the retired session-ledger commits.
 *
 * A pure server component: `<details>` opens a day with no JavaScript.
 */
import { execFileSync } from "node:child_process";
import type { Metadata } from "next";

import { PageTabs, HELP_TABS } from "@/components/PageTabs";
import { Card, MetaLine, PageHeader, StatementBlock } from "@/components/ui";

export const metadata: Metadata = { title: "Changelog" };
export const dynamic = "force-static";

interface Commit {
  sha: string;
  date: string;
  subject: string;
}

const LEDGER = /^companion: (log|close) session /;

function readLog(): Commit[] {
  try {
    const out = execFileSync(
      "git",
      ["log", "--no-merges", "-n", "400", "--date=short", "--format=%h%x1f%ad%x1f%s"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, date, subject] = line.split("\x1f");
        return { sha, date, subject };
      })
      .filter((c) => !LEDGER.test(c.subject))
      .map((c) => ({ ...c, subject: c.subject.replace(/^companion:\s*/, "") }));
  } catch {
    return [];
  }
}

/** "Wed, Sep 3" from a YYYY-MM-DD commit date. */
function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default function ChangelogPage() {
  const commits = readLog();
  const days = new Map<string, Commit[]>();
  for (const c of commits) days.set(c.date, [...(days.get(c.date) ?? []), c]);

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const recent = commits.filter((c) => c.date >= cutoff).length;

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6">
      <PageTabs tabs={HELP_TABS} />
      <PageHeader title="Changelog" description="What reached the app, newest first. One row per change." />

      <StatementBlock
        label="Changes · last 30 days"
        value={recent}
        sub={`${commits.length} changes shown in all`}
        footnote="Read when this version of the app was built. Work still in the queue shows up once it lands."
      />

      {commits.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">
          No history was readable when this version was built.
        </p>
      ) : (
        <Card pad={false} className="mt-8 divide-y divide-line-soft overflow-hidden">
          {[...days].map(([date, list], i) => (
            <details key={date} className="group" open={i === 0}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 marker:hidden hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{dayLabel(date)}</span>
                <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  {list.length} {list.length === 1 ? "change" : "changes"}
                </span>
                <span aria-hidden className="shrink-0 text-neutral-400 transition-transform group-open:rotate-90">
                  ›
                </span>
              </summary>
              <ul className="space-y-2.5 border-t border-line-soft bg-neutral-50/60 px-4 py-3 dark:bg-neutral-800/30">
                {list.map((c) => (
                  <li key={c.sha}>
                    <p className="text-[13px] leading-snug">{c.subject}</p>
                    <MetaLine
                      className="mt-0.5"
                      items={[
                        <span key="sha" className="font-mono">
                          {c.sha}
                        </span>,
                      ]}
                    />
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </Card>
      )}
    </main>
  );
}
