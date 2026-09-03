"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Banner, Loading, MetaLine, btn } from "@/components/ui";
import { InvoiceTagCard } from "./InvoiceTagCard";
import { RecordEditor, type ReadOnlyRow, type ScalarSpec } from "./RecordEditor";
import type { InvoiceTag, JobDetail } from "./types";

/**
 * ONE JOB, in full — its editable JobTread record, everything JobTread holds
 * about it that this app will not change, and its invoice capture email tag.
 *
 * The read-only half is not filler. It is the answer to "is this job actually
 * set up right": whether QuickBooks knows it (`qboId`), what tax rate the site
 * resolves to, whether the schedule is published, how much JobTread thinks it
 * has cost. Every figure here is JobTread's own — nothing on this page
 * recomputes a cost.
 */

const PRICE_TYPES = [
  { value: "costPlus", label: "Cost plus" },
  { value: "fixed", label: "Fixed price" },
];

/** JobTread caps `name` at 30 and `number` at 16; the route refuses more. */
const JOB_SCALARS: ScalarSpec[] = [
  { name: "name", label: "Job name", kind: "text", maxLength: 30, help: "Up to 30 characters — JobTread's own limit." },
  { name: "number", label: "Job number", kind: "text", maxLength: 16 },
  { name: "priceType", label: "Price type", kind: "select", options: PRICE_TYPES },
  {
    name: "closedOn",
    label: "Closed on",
    kind: "date",
    help: "Set this and the job leaves the open-jobs lists everywhere in the app.",
  },
  { name: "description", label: "Description", kind: "textarea", maxLength: 32768 },
];

const money = (n: number | null) =>
  n == null
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const dateLabel = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);

function readOnlyRows(job: JobDetail): ReadOnlyRow[] {
  const loc = job.location;
  return [
    { label: "Customer", value: job.customer.name },
    { label: "Site", value: loc?.formattedAddress || loc?.name || "" },
    {
      label: "Tax rate",
      value: loc ? (loc.customTaxRate != null ? pct(loc.customTaxRate) : pct(loc.taxRate)) : "—",
      note:
        loc?.customTaxRate != null
          ? "A custom rate overrides the address lookup. Change it in JobTread."
          : "JobTread's own lookup for the site address.",
    },
    { label: "Created", value: dateLabel(job.createdAt) },
    {
      label: "Retainage",
      value: job.defaultRetainagePercentage == null ? "—" : String(job.defaultRetainagePercentage),
      note: "Read-only here — JobTread states a number without stating its unit.",
    },
    { label: "Cost so far", value: money(job.actualCost), note: "JobTread's own figure." },
    { label: "Projected cost", value: money(job.projectedCost) },
    { label: "Projected price", value: money(job.projectedPrice) },
    {
      label: "QuickBooks",
      value: job.qboName ? `${job.qboName} (${job.qboId || "no id"})` : job.qboId || "Not linked",
    },
    { label: "Next bill billable", value: job.qboNextBillIsBillable ? "Yes" : "No" },
    { label: "Schedule published", value: job.scheduleIsPublished ? "Yes" : "No" },
    { label: "Simple selections", value: job.useSimpleSelections ? "Yes" : "No" },
    { label: "CompanyCam", value: job.companycamName || "Not linked" },
    { label: "Time zone", value: loc?.timeZone || "" },
    {
      label: "In JobTread",
      value: `${job.counts.documents} docs · ${job.counts.files} files · ${job.counts.tasks} tasks · ${job.counts.timeEntries} time entries`,
    },
    { label: "Areas", value: job.areas.length ? job.areas.join(", ") : "" },
    { label: "Folders", value: job.folders.length ? `${job.folders.length} file folders` : "" },
  ];
}

export function JobPanel({
  jobId,
  tag,
  tagListError,
  onTagCreated,
  onRenamed,
}: {
  jobId: string;
  tag: InvoiceTag | null;
  tagListError?: string;
  onTagCreated?: (tag: InvoiceTag) => void;
  /** Lets the list behind this panel redraw without a full reload. */
  onRenamed?: (jobId: string, saved: Record<string, unknown>) => void;
}) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/clients/job?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j: { job?: JobDetail; error?: string }) => {
        if (j.error) throw new Error(j.error);
        setJob(j.job ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(load, [load]);

  if (loading && !job) return <Loading label="Loading the job…" />;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!job) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight">{job.name}</h2>
        <MetaLine
          items={[
            job.customer.name,
            job.number ? `#${job.number}` : "No job number",
            job.closedOn ? `Closed ${dateLabel(job.closedOn)}` : "Open",
          ]}
          className="mt-1"
        />
      </div>

      <RecordEditor
        key={`job-${job.id}`}
        kind="job"
        id={job.id}
        heading="Job details"
        scalars={JOB_SCALARS}
        values={{
          name: job.name,
          number: job.number,
          priceType: job.priceType,
          closedOn: job.closedOn,
          description: job.description,
        }}
        fields={job.fields}
        readOnly={readOnlyRows(job)}
        onSaved={(saved) => {
          onRenamed?.(job.id, saved);
          load(); // re-read: a saved custom field is a connection, not a scalar
        }}
      />

      <InvoiceTagCard
        jobId={job.id}
        tag={tag}
        listError={tagListError}
        onCreated={onTagCreated}
      />

      <Link href={`/trackingsheet?jobId=${encodeURIComponent(job.id)}`} className={btn("secondary", "md")}>
        Open in Tracking Sheets
      </Link>
    </div>
  );
}
