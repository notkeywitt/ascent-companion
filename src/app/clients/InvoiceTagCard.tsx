"use client";

import { useState } from "react";
import { Banner, Button, Card, Chip, MetaLine, SectionHeading } from "@/components/ui";
import type { InvoiceTag } from "./types";

/**
 * A job's INVOICE CAPTURE EMAIL TAG — the Gmail label that turns a forwarded
 * invoice into a logged bill on this job.
 *
 * Apps Script scans Gmail every 15 minutes for mail labelled
 * `_JT Invoice <Customer> - <Job>` and runs the whole capture against that job:
 * Drive file, Expenditure row, optional JobTread draft. The label IS the
 * "which job" answer, so a job without one cannot be captured this way.
 *
 * Creating it used to mean typing the label into Gmail by hand, and a label
 * that does not match a project is a tag the scan leaves stuck forever rather
 * than filing against a guessed job. So this button sends only the job id;
 * Apps Script composes the text from the same project list its resolver reads.
 *
 * Three states, and the third one is the point:
 *   • the tag exists  → show it, so it can be copied into a Gmail filter
 *   • the tag is missing → one button creates it
 *   • the job is not in the Projects sheet with a JobTread id → no tag is
 *     possible, and saying so beats a button that quietly makes a dead label
 */
export function InvoiceTagCard({
  jobId,
  tag,
  listError,
  onCreated,
}: {
  jobId: string;
  /** This job's row from `listInvoiceTags`, or null when the job has no row. */
  tag: InvoiceTag | null;
  /** Why the tag list could not be read, when it could not. */
  listError?: string;
  onCreated?: (tag: InvoiceTag) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string>("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clients/invoice-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const json = (await res.json()) as {
        error?: string;
        tag?: string;
        label?: string;
        created?: boolean;
      };
      if (!res.ok || json.error || !json.tag) {
        throw new Error(json.error ?? `Could not create the tag (HTTP ${res.status})`);
      }
      setCreated(json.tag);
      onCreated?.({
        jobId,
        projectId: "",
        label: json.label ?? "",
        tag: json.tag,
        exists: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const live = created || (tag?.exists ? tag.tag : "");

  return (
    <section className="space-y-3">
      <SectionHeading
        trailing={
          live ? (
            <Chip tone="success">Tag ready</Chip>
          ) : (
            <Chip tone="warning">No tag</Chip>
          )
        }
      >
        Invoice capture email tag
      </SectionHeading>

      <Card className="space-y-3">
        {live ? (
          <>
            <p className="break-words font-mono text-sm">{live}</p>
            <MetaLine
              items={[
                "Label an invoice email with this in Gmail",
                "The capture scan logs it against this job within 15 minutes",
              ]}
            />
          </>
        ) : listError ? (
          <Banner tone="warning">{listError}</Banner>
        ) : tag ? (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              This job has no capture label yet. Creating it adds{" "}
              <span className="break-words font-mono">{tag.tag}</span> to Gmail — nothing
              else changes.
            </p>
            <Button onClick={create} disabled={busy}>
              {busy ? "Creating…" : "Create the tag"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              This job has no row in the Projects sheet carrying a JobTread Job ID, so a
              tag for it could not be matched back to the job. Run the Projects sync, then
              come back.
            </p>
            <MetaLine items={["Tagged mail that resolves to no project is left in place, never filed against a guessed job"]} />
          </>
        )}
        {error && <Banner tone="error">{error}</Banner>}
      </Card>
    </section>
  );
}
