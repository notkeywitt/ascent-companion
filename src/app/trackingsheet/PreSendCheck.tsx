"use client";

import Link from "next/link";
import { Banner, Card, Chip, SectionHeading } from "@/components/ui";
import { money } from "@/lib/invoiceReview/types";
import type { Finding } from "@/lib/invoiceReview/types";
import { checkedAtLabel, clearedCount, openFindings, tally } from "./preSendMemory";
import type { JobRun } from "./usePreSendCheck";

/**
 * CHECK BEFORE YOU SEND — the invoice review's checks, on this job, on demand.
 *
 * The monthly review is a late catch: by the time it runs the invoice may
 * already be with the client, and every mistake costs a credit or a
 * conversation. This is the same checks at the moment they are cheap.
 *
 * Deliberately a BUTTON, not something that runs on render. It costs several
 * JobTread round trips, and a check that fires every time the page loads is a
 * check people learn to ignore.
 *
 * Presentational: the run state lives on the Board, and so does the trigger —
 * the bottom action row beside Approve Draft Bills on a desktop, the action
 * drawer on a phone. This card is the RESULT, and the Board renders it only
 * once there is one.
 */
export function PreSendCheck({
  run,
  linkFor,
  onRecheck,
  onClear,
  onUnclear,
}: {
  run: JobRun;
} & FindingActions) {
  const mem = run.mem;
  const result = mem?.result ?? null;
  const open = mem ? openFindings(mem) : [];
  const { errors, warnings } = mem ? tally(mem) : { errors: 0, warnings: 0 };
  const settled = mem ? mem.fixed.length + clearedCount(mem) : 0;

  return (
    <Card className="mb-4">
      <SectionHeading
        className="mb-2"
        trailing={
          <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
            {run.state !== "idle" ? "Checking…" : mem ? `Checked ${checkedAtLabel(mem.at)}` : ""}
          </span>
        }
      >
        Before you send
      </SectionHeading>

      {run.error ? (
        <Banner tone="error" className="mt-1">
          {run.error}
        </Banner>
      ) : null}

      {result && mem ? (
        <>
          {/* A gate that could not read the job must never render as a clean one. */}
          {result.evidenceWarnings.length ? (
            <Banner tone="error" className="mb-3">
              <span className="font-medium">This check is incomplete.</span>{" "}
              {result.evidenceWarnings.join(" · ")}
            </Banner>
          ) : null}

          {result.empty && !open.length && !mem.fixed.length ? (
            <Banner tone="neutral" className="mb-3">
              Nothing to check — this job has no bills or invoices for {result.monthLabel}.
            </Banner>
          ) : !open.length ? (
            <Banner tone="success" className="mb-3">
              {settled ? "Nothing left open" : "Nothing to fix"} on {result.jobName || "this job"}{" "}
              for {result.monthLabel}.
            </Banner>
          ) : (
            <Banner tone={errors ? "warning" : "neutral"} className="mb-3">
              {errors ? `${errors} to fix` : ""}
              {errors && warnings ? ", " : ""}
              {warnings ? `${warnings} to look at` : ""} on {result.jobName || "this job"} for{" "}
              {result.monthLabel}.
            </Banner>
          )}

          <JobFindings
            run={run}
            linkFor={linkFor}
            onRecheck={onRecheck}
            onClear={onClear}
            onUnclear={onUnclear}
            className="mb-1 border-t border-line-soft"
          />
        </>
      ) : null}
    </Card>
  );
}

/**
 * Where a finding's row takes you. The host decides, because the same finding
 * opens differently from the board (the bill in place, the labor list
 * narrowed) and from the all-jobs view (a bill popup, a link to the board).
 */
export interface FindingLink {
  label: string;
  /** A page to go to — `http…` opens in a new tab. */
  href?: string;
  /** …or something to do on this screen. */
  onClick?: () => void;
}

export interface FindingActions {
  linkFor: (f: Finding) => FindingLink | null;
  onRecheck: (key: string) => void;
  onClear: (key: string) => void;
  onUnclear: () => void;
}

/** The finding's own `sourceLink`, for anything the host has no better place for. */
export function sourceLinkOf(f: Finding): FindingLink | null {
  return f.sourceLink ? { label: f.sourceLabel ?? "Open", href: f.sourceLink } : null;
}

const action =
  "inline-flex min-h-9 items-center text-xs font-semibold text-accent transition hover:underline disabled:cursor-default disabled:opacity-50 disabled:hover:no-underline lg:min-h-0";

function RowLink({ link }: { link: FindingLink }) {
  if (link.onClick) {
    return (
      <button type="button" className={action} onClick={link.onClick}>
        {link.label}
      </button>
    );
  }
  if (!link.href) return null;
  if (link.href.startsWith("http")) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer" className={action}>
        {link.label} ↗
      </a>
    );
  }
  return (
    <Link href={link.href} className={action}>
      {link.label}
    </Link>
  );
}

/**
 * One job's findings, worst first — the open ones with their actions, then
 * the ones a later run found fixed, then how many were cleared. Shared by the
 * board's "Before you send" card and "Check all Jobs".
 *
 * Re-check re-runs the whole job (the route checks a job, not a finding), so
 * every row's Re-check waits while any run of that job is going.
 */
export function JobFindings({
  run,
  linkFor,
  onRecheck,
  onClear,
  onUnclear,
  className = "",
}: { run: JobRun; className?: string } & FindingActions) {
  const mem = run.mem;
  if (!mem) return null;
  const open = openFindings(mem);
  const cleared = clearedCount(mem);
  const busy = run.state !== "idle";
  if (!open.length && !mem.fixed.length && !cleared) return null;

  return (
    <ul className={`divide-y divide-line-soft ${className}`}>
      {open.map((f) => {
        const link = linkFor(f);
        const note = run.notes[f.key];
        return (
          <li key={f.key} className="flex items-start gap-3 py-2">
            <Chip tone={f.severity === "error" ? "danger" : "warning"}>
              {f.severity === "error" ? "Fix" : "Look"}
            </Chip>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{f.title}</span>
              <span className="block text-xs leading-relaxed opacity-70">{f.detail}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-4">
                {link && <RowLink link={link} />}
                <button
                  type="button"
                  className={action}
                  disabled={busy}
                  onClick={() => onRecheck(f.key)}
                  title="Run this job's check again and see whether this is still there"
                >
                  {busy && run.recheckKey === f.key ? "Checking…" : "Re-check"}
                </button>
                <button
                  type="button"
                  className={action}
                  onClick={() => onClear(f.key)}
                  title="Take this off the list. On this device only — the monthly review still reports it."
                >
                  Clear
                </button>
              </span>
              {note && (
                <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                  {note}
                </span>
              )}
            </span>
            {f.amount == null ? null : (
              <span className="shrink-0 text-sm tabular-nums opacity-70">{money(f.amount)}</span>
            )}
          </li>
        );
      })}

      {mem.fixed.map((f) => (
        <li key={f.key} className="flex items-start gap-3 py-2">
          <span className="w-9 shrink-0 text-center text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            ✓
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-neutral-500 line-through decoration-neutral-400 dark:text-neutral-400">
              {f.title}
            </span>
            <span className="flex flex-wrap items-center gap-x-4 text-[11px] text-neutral-500 dark:text-neutral-400">
              Fixed — a later check no longer finds it.
              <button type="button" className={action} onClick={() => onClear(f.key)}>
                Clear
              </button>
            </span>
          </span>
        </li>
      ))}

      {cleared > 0 && (
        <li className="flex items-center gap-3 py-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          {cleared} cleared on this device.
          <button type="button" className={action} onClick={onUnclear}>
            Show again
          </button>
        </li>
      )}
    </ul>
  );
}
