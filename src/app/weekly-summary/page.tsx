/**
 * Weekly Summary — the office's weekly email to Casey and Ty, newest on top,
 * every earlier week listed under it.
 *
 * Read from the files the /weekly-summary skill commits
 * (`.claude/skills/weekly-summary/drafts/`) when the page builds, the way the
 * changelog reads `git log`. `force-static` makes that the only time it runs:
 * a new summary appears once the lander deploys the change that carries it.
 * Nothing here reads or writes JobTread or the companion database.
 */
import type { Metadata } from "next";

import { Card, EmptyState, MetaLine, PageHeader, SectionHeading } from "@/components/ui";
import { readSummaries, type SummaryRecord } from "@/lib/weeklySummaryFiles";

import { SummaryView } from "./SummaryView";

export const metadata: Metadata = { title: "Weekly Summary" };
export const dynamic = "force-static";

/** "Nov 21, 2026" from a YYYY-MM-DD week-end. */
function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Meta({ r }: { r: SummaryRecord }) {
  return (
    <MetaLine
      items={[
        r.kind === "final" ? "Final" : "Draft",
        r.docUrl && (
          <a key="doc" href={r.docUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Printable Doc
          </a>
        ),
      ]}
    />
  );
}

export default function WeeklySummaryPage() {
  const [latest, ...earlier] = readSummaries();

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader title="Weekly Summary" />

      {!latest ? (
        <EmptyState className="mt-6">No weekly summary has been saved yet. Run /weekly-summary to write one.</EmptyState>
      ) : (
        <>
          <section className="mt-2">
            <h2 className="text-lg font-semibold tracking-tight">{latest.title || `Week ending ${dayLabel(latest.weekEnd)}`}</h2>
            <Meta r={latest} />
            <div className="mt-5">
              <SummaryView blocks={latest.blocks} />
            </div>
          </section>

          {earlier.length > 0 && (
            <section className="mt-12">
              <SectionHeading trailing={<span className="text-[12px] text-neutral-500">{earlier.length}</span>}>
                Earlier weeks
              </SectionHeading>
              <Card pad={false} className="mt-3 divide-y divide-line-soft overflow-hidden">
                {earlier.map((r) => (
                  <details key={r.weekEnd} className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 marker:hidden hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">
                        {r.title || `Week ending ${dayLabel(r.weekEnd)}`}
                      </span>
                      <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
                        {r.kind === "final" ? "Final" : "Draft"}
                      </span>
                      <span aria-hidden className="shrink-0 text-neutral-400 transition-transform group-open:rotate-90">
                        ›
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-line-soft bg-neutral-50/60 px-4 py-4 dark:bg-neutral-800/30">
                      <Meta r={r} />
                      <SummaryView blocks={r.blocks} />
                    </div>
                  </details>
                ))}
              </Card>
            </section>
          )}
        </>
      )}
    </main>
  );
}
