"use client";

import { Banner, Button, Card, Chip, SectionHeading } from "@/components/ui";
import { money } from "@/lib/invoiceReview/types";
import type { Finding } from "@/lib/invoiceReview/types";
import type { PreSendResult } from "@/lib/invoiceReview/preSend";

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
 * Presentational: the run state lives on the Board so the trigger can sit in
 * the phone's action drawer. This card is the RESULT. Its own trigger button is
 * desktop-only (`hidden lg:inline-flex`); on a phone the drawer carries it.
 */
export function PreSendCheck({
  result,
  running,
  error,
  onRun,
  jobId,
}: {
  result: PreSendResult | null;
  running: boolean;
  error: string;
  onRun: () => void;
  jobId: string;
}) {
  const live: Finding[] = (result?.findings ?? []).filter((f) => !f.suppressedBy);

  return (
    <Card className="mb-4">
      <SectionHeading
        className="mb-2"
        trailing={
          <Button
            size="sm"
            variant="outline"
            onClick={onRun}
            disabled={running || !jobId}
            className="hidden lg:inline-flex"
          >
            {running ? "Checking…" : result ? "Check again" : "Check this job"}
          </Button>
        }
      >
        Before you send
      </SectionHeading>

      {error ? (
        <Banner tone="error" className="mt-1">
          {error}
        </Banner>
      ) : null}

      {result ? (
        <>
          {/* A gate that could not read the job must never render as a clean one. */}
          {result.evidenceWarnings.length ? (
            <Banner tone="error" className="mb-3">
              <span className="font-medium">This check is incomplete.</span>{" "}
              {result.evidenceWarnings.join(" · ")}
            </Banner>
          ) : null}

          {result.empty ? (
            <Banner tone="neutral" className="mb-3">
              Nothing to check — this job has no bills or invoices for {result.monthLabel}.
            </Banner>
          ) : !live.length ? (
            <Banner tone="success" className="mb-3">
              Nothing to fix on {result.jobName || "this job"} for {result.monthLabel}.
            </Banner>
          ) : (
            <Banner tone={result.errors ? "warning" : "neutral"} className="mb-3">
              {result.errors ? `${result.errors} to fix` : ""}
              {result.errors && result.warnings ? ", " : ""}
              {result.warnings ? `${result.warnings} to look at` : ""} on{" "}
              {result.jobName || "this job"} for {result.monthLabel}.
            </Banner>
          )}

          {live.length ? (
            <ul className="mb-3 divide-y divide-line-soft border-y border-line-soft">
              {live.map((f) => (
                <li key={f.key} className="flex items-start gap-3 py-2">
                  <Chip tone={f.severity === "error" ? "danger" : "warning"}>
                    {f.severity === "error" ? "Fix" : "Look"}
                  </Chip>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{f.title}</span>
                    <span className="block text-xs leading-relaxed opacity-70">{f.detail}</span>
                  </span>
                  {f.amount == null ? null : (
                    <span className="shrink-0 text-sm tabular-nums opacity-70">
                      {money(f.amount)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
