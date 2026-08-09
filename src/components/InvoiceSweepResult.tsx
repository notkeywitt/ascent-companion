"use client";

import { useEffect } from "react";
import { btn } from "@/components/ui";

/**
 * The post-run notice for the "Import tagged email invoices" sweep (the Apps
 * Script scanJtInvoiceCaptureTags task). Runs on demand, then this modal reports
 * what it did — the same kind of clear notice as the unmatched-vendor popup, but
 * triggered by the action's result rather than a background poll.
 *
 * The sweep logs every email you tagged "_JT Invoice <Customer> - <Job>" as a
 * bill on that job. Its old feedback was a single count line ("3 logged"), so a
 * tag that silently didn't match a job — or an email that failed to import — was
 * invisible. This lists every swept email by outcome, each with a link back to
 * the Gmail thread so you can act on it.
 *
 * Fed by the task's structured result (returnsDetail in the Apps Script
 * registry), surfaced through POST /api/actions as `result`. Rendered by both
 * the Home admin bar and the /actions page.
 */

export type SweepKind = "logged" | "skipped" | "unmatched" | "failed";

export interface SweepItem {
  kind: SweepKind;
  subject: string;
  project?: string;
  /** The "_JT Invoice …" label that didn't resolve (unmatched only). */
  tag?: string;
  expId?: string;
  autoPushed?: boolean;
  /** Gmail permalink to the thread (may be "" if unavailable). */
  emailUrl?: string;
  error?: string;
}

export interface SweepResult {
  processed: number;
  logged: number;
  skipped: number;
  unmatched: number;
  failed: number;
  dryRun?: boolean;
  items?: SweepItem[];
}

/** Type guard for the value POST /api/actions returns under `result`. */
export function isSweepResult(v: unknown): v is SweepResult {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as SweepResult).logged === "number" &&
    typeof (v as SweepResult).unmatched === "number"
  );
}

/** External-thread link — opens Gmail in a new tab (correct when the app is
 *  iframed in the Chrome side panel and when it's the full web app). */
function EmailLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
    >
      View email ↗
    </a>
  );
}

function Row({ item }: { item: SweepItem }) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.subject || "(no subject)"}</div>
        <div className="mt-0.5 truncate text-xs text-neutral-500">
          {item.kind === "unmatched"
            ? item.tag
              ? `Tag doesn’t match a job: ${item.tag}`
              : "Tag doesn’t match a job"
            : item.kind === "failed"
              ? item.error || "Couldn’t import"
              : item.project || ""}
          {item.kind === "logged" && item.expId ? ` · ${item.expId}` : ""}
          {item.kind === "logged" && item.autoPushed ? " · pushed to JobTread" : ""}
        </div>
      </div>
      <EmailLink url={item.emailUrl} />
    </li>
  );
}

function Group({
  title,
  tone,
  hint,
  items,
}: {
  title: string;
  tone: "success" | "warning" | "error" | "neutral";
  hint?: string;
  items: SweepItem[];
}) {
  if (items.length === 0) return null;
  const head: Record<typeof tone, string> = {
    success: "text-emerald-700 dark:text-emerald-300",
    warning: "text-amber-800 dark:text-amber-300",
    error: "text-red-700 dark:text-red-300",
    neutral: "text-neutral-600 dark:text-neutral-300",
  };
  return (
    <section className="mt-4 first:mt-0">
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${head[tone]}`}>
        {title} ({items.length})
      </div>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      <ul className="mt-1.5 divide-y divide-neutral-200 rounded-xl border border-line dark:divide-neutral-700/60 ">
        {items.map((it, i) => (
          <Row key={(it.expId || it.subject || "row") + i} item={it} />
        ))}
      </ul>
    </section>
  );
}

export function InvoiceSweepResultModal({
  result,
  onClose,
}: {
  result: SweepResult | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!result) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, onClose]);

  if (!result) return null;

  const items = result.items ?? [];
  const logged = items.filter((i) => i.kind === "logged");
  const unmatched = items.filter((i) => i.kind === "unmatched");
  const failed = items.filter((i) => i.kind === "failed");
  const skipped = items.filter((i) => i.kind === "skipped");

  const nothing = items.length === 0;
  const anyProblem = unmatched.length > 0 || failed.length > 0;

  const title = nothing
    ? "No tagged invoices to import"
    : logged.length > 0
      ? `Imported ${logged.length} invoice${logged.length === 1 ? "" : "s"}`
      : "Nothing new imported";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sweep-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:bg-ink-raised"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              anyProblem
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              {anyProblem ? (
                <>
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <path d="M12 9v4M12 17h.01" />
                </>
              ) : (
                <path d="m4 13 4 4L20 5" />
              )}
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="sweep-title" className="text-base font-bold tracking-tight">
              {title}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {nothing
                ? "Tag an email “_JT Invoice <Customer> - <Job>” and run this again to log it as a bill."
                : anyProblem
                  ? "Some emails need attention — see below."
                  : "All caught up."}
            </p>
          </div>
        </div>

        <Group
          title="Imported"
          tone="success"
          hint="Logged as a bill and pushed to JobTread."
          items={logged}
        />
        <Group
          title="Couldn’t match a job"
          tone="warning"
          hint="The tag doesn’t match a job in JobTread. Fix the label on the email, then run again."
          items={unmatched}
        />
        <Group
          title="Failed to import"
          tone="error"
          hint="Left tagged so the next run retries automatically."
          items={failed}
        />
        <Group
          title="Already imported"
          tone="neutral"
          hint="Previously logged — the tag was just cleared."
          items={skipped}
        />

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className={btn("primary", "md")}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
