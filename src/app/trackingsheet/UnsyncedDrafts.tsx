"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Chip, CountBadge, SectionHeading } from "@/components/ui";
import { discardDraft, draftSavedAtLabel, listDrafts, type DraftSummary } from "@/lib/codingDraft";

/**
 * "Unfinished coding" — where you left off, on the Tracking Sheets landing.
 *
 * Coding staged in this app is saved and offered back when you return to the
 * screen you left (see src/lib/codingDraft.ts). That works, but it only works if
 * you REMEMBER to go back: a bill half-coded on a phone on Friday is invisible
 * on Monday unless you happen to open that exact bill. This is the other half —
 * a list of every scope still holding work, so unfinished coding is something
 * you can see rather than something you have to recall.
 *
 * It reads BOTH layers: this device's drafts, plus the ones the companion DB is
 * holding. A draft only the server has is work left on ANOTHER device, and it
 * says so — that row is the one the office could never otherwise find.
 *
 * None of it is in JobTread. Every row is a decision waiting for a Sync or a
 * Save, which is why the rows go to the screen that commits them rather than
 * offering to commit anything from here.
 *
 * Renders nothing when there's nothing outstanding — the common case, and it
 * shouldn't cost the landing page a row of chrome to say so.
 */
export function UnsyncedDrafts() {
  const [rows, setRows] = useState<DraftSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    listDrafts()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  const discard = useCallback((row: DraftSummary) => {
    if (
      !window.confirm(
        `Discard the unsynced coding on ${row.label}?\n\n` +
          `${row.count} change${row.count === 1 ? "" : "s"} that never reached JobTread. ` +
          `This can't be undone.`,
      )
    )
      return;
    discardDraft(row.key);
    setRows((prev) => (prev ?? []).filter((r) => r.key !== row.key));
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section className="mb-4">
      <SectionHeading
        className="mb-2"
        trailing={<CountBadge n={rows.length} />}
      >
        Unfinished coding
      </SectionHeading>

      <Card pad={false} className="overflow-hidden">
        <p className="border-b border-line-soft px-4 py-2.5 text-xs text-neutral-500 dark:text-neutral-400">
          Saved on your way out, and not in JobTread. Open one to finish it and Sync.
        </p>

        <ul>
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-stretch border-b border-line-soft last:border-b-0"
            >
              {/* The row and its Discard are SIBLINGS, not one nested in the
                  other: a button inside a link is invalid, and on a phone it is
                  also the fastest way to throw work away by mistake. */}
              <Link
                href={row.href}
                className="min-w-0 flex-1 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-white/5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{row.label}</span>
                  {row.elsewhere && (
                    <Chip tone="neutral" title="Left on another device — this one has no copy">
                      other device
                    </Chip>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                  {row.count} unsynced change{row.count === 1 ? "" : "s"} ·{" "}
                  {row.kind === "job" ? "job workbench" : "bill"} ·{" "}
                  {draftSavedAtLabel(row.savedAt)}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => discard(row)}
                className="shrink-0 px-4 text-xs font-semibold text-neutral-500 underline-offset-2 hover:text-red-600 hover:underline dark:text-neutral-400 dark:hover:text-red-400"
              >
                Discard
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
