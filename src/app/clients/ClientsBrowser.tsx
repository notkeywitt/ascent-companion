"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Chip,
  ChipScroller,
  CountBadge,
  EmptyState,
  FilterChip,
  Input,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
} from "@/components/ui";
import { CustomerPanel } from "./CustomerPanel";
import { JobPanel } from "./JobPanel";
import type { ClientDirectory, DirectoryCustomer, DirectoryJob, InvoiceTag, InvoiceTagList } from "./types";

/**
 * CLIENTS & JOBS — the directory over JobTread's customer and job records.
 *
 * The app already reads a job's COST (`/jobs`) and a month's billing
 * (`/trackingsheet`). What it had nowhere was the record itself: who the client
 * is, which jobs are theirs, what JobTread holds about each, and a way to fix
 * any of it without opening JobTread on a laptop. That is this page.
 *
 * ONE PAYLOAD, THREE SCREENS. The directory (every customer, every job) arrives
 * in one fetch and stays; opening a customer or a job adds one read of that
 * record. So the list is instant, filtering never hits the network, and a save
 * re-reads only the record that was saved.
 *
 * THE FILTER IS A FILTER, NOT A SEARCH. It narrows the list already on screen —
 * no request per keystroke. The app's one search box lives in the header and
 * answers across pages; this only sorts out an org of a couple of dozen
 * customers.
 *
 * THE TAG LIST IS LOADED ONCE, HERE. `listInvoiceTags` is one Apps Script round
 * trip (~1–3 s) that answers for EVERY job at once, so fetching it per job
 * would make opening a job feel slow for no reason. It is also allowed to fail:
 * the Apps Script bridge is deployed by hand, and a job's details are still
 * worth showing when the capture tag cannot be read.
 */

type View =
  | { kind: "list" }
  | { kind: "customer"; id: string }
  | { kind: "job"; id: string };

const norm = (s: string) => s.toLowerCase().trim();

function jobMatches(j: DirectoryJob, q: string) {
  return (
    norm(j.name).includes(q) ||
    norm(j.number).includes(q) ||
    norm(j.customer).includes(q) ||
    norm(j.address).includes(q) ||
    norm(j.phase).includes(q) ||
    norm(j.status).includes(q)
  );
}

function customerMatches(c: DirectoryCustomer, q: string) {
  return (
    norm(c.name).includes(q) ||
    norm(c.contactName).includes(q) ||
    norm(c.address).includes(q) ||
    c.jobs.some((j) => jobMatches(j, q))
  );
}

/** Jobs at the top of the list read better with their phase than with nothing. */
function jobDesc(j: DirectoryJob) {
  return [j.number ? `#${j.number}` : "", j.phase, j.address].filter(Boolean).join(" · ");
}

/**
 * A job row's capture-tag mark. Three answers, and the third one matters: a job
 * with no row in the Projects sheet cannot have a tag at all, so drawing nothing
 * would read as "it has one".
 */
function JobTagChip({
  jobId,
  tags,
  missing,
}: {
  jobId: string;
  tags: InvoiceTagList | null;
  missing: Set<string>;
}) {
  if (!tags) return null; // list not read — say nothing rather than something wrong
  if (missing.has(jobId)) return <Chip tone="warning">No tag</Chip>;
  if (!tags.tags.some((t) => t.jobId === jobId)) {
    return (
      <Chip tone="neutral" title="No Projects-sheet row with a JobTread Job ID, so no tag is possible">
        No project
      </Chip>
    );
  }
  return null;
}

export function ClientsBrowser() {
  const [directory, setDirectory] = useState<ClientDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tags, setTags] = useState<InvoiceTagList | null>(null);
  const [tagError, setTagError] = useState("");

  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [needsTagOnly, setNeedsTagOnly] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });

  const loadDirectory = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/clients")
      .then((r) => r.json())
      .then((j: ClientDirectory & { error?: string }) => {
        if (j.error) throw new Error(j.error);
        setDirectory({ customers: j.customers ?? [], orphanJobs: j.orphanJobs ?? [] });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(loadDirectory, [loadDirectory]);

  useEffect(() => {
    let alive = true;
    fetch("/api/clients/invoice-tag")
      .then((r) => r.json())
      .then((j: InvoiceTagList & { error?: string }) => {
        if (!alive) return;
        if (j.error) {
          setTagError(String(j.error));
          return;
        }
        setTags({ prefix: j.prefix ?? "", tags: j.tags ?? [], unresolved: j.unresolved ?? [] });
      })
      .catch((e) => alive && setTagError(e instanceof Error ? e.message : "Network error"));
    return () => {
      alive = false;
    };
  }, []);

  const tagByJob = useMemo(() => {
    const m = new Map<string, InvoiceTag>();
    for (const t of tags?.tags ?? []) m.set(t.jobId, t);
    return m;
  }, [tags]);

  /** Jobs with a recognized tag row that has not been created in Gmail yet. */
  const missingTagJobs = useMemo(() => {
    const out = new Set<string>();
    for (const t of tags?.tags ?? []) if (!t.exists) out.add(t.jobId);
    return out;
  }, [tags]);

  const q = norm(query);

  const visible = useMemo(() => {
    if (!directory) return { customers: [] as DirectoryCustomer[], jobs: [] as DirectoryJob[] };
    const keepJob = (j: DirectoryJob) =>
      (showClosed || !j.closedOn) &&
      (!needsTagOnly || missingTagJobs.has(j.id)) &&
      (!q || jobMatches(j, q));

    const customers = directory.customers
      .map((c) => ({ ...c, jobs: c.jobs.filter((j) => (showClosed || !j.closedOn)) }))
      .filter((c) => (!q || customerMatches(c, q)))
      .filter((c) => !needsTagOnly || c.jobs.some((j) => missingTagJobs.has(j.id)));

    const jobs = [...directory.customers.flatMap((c) => c.jobs), ...directory.orphanJobs]
      .filter(keepJob)
      .sort((a, b) => a.customer.localeCompare(b.customer) || a.name.localeCompare(b.name));

    return { customers, jobs };
  }, [directory, q, showClosed, needsTagOnly, missingTagJobs]);

  const allJobs = useMemo(
    () =>
      directory
        ? [...directory.customers.flatMap((c) => c.jobs), ...directory.orphanJobs]
        : [],
    [directory],
  );

  const openCustomer = view.kind === "customer"
    ? (directory?.customers.find((c) => c.id === view.id) ?? null)
    : null;

  function back() {
    setView({ kind: "list" });
  }

  /** Fold a created tag into the loaded list, so the list's chips update too. */
  const noteTagCreated = useCallback((t: InvoiceTag) => {
    setTags((prev) =>
      prev
        ? {
            ...prev,
            tags: prev.tags.map((row) => (row.jobId === t.jobId ? { ...row, exists: true } : row)),
          }
        : prev,
    );
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Clients & Jobs"
        description="Every customer and job in JobTread — the record, not the cost. Edit it here."
      />

      {view.kind !== "list" && (
        <button
          type="button"
          onClick={back}
          className="mb-4 text-sm font-semibold text-accent hover:underline"
        >
          ‹ Back to the list
        </button>
      )}

      {view.kind === "job" && (
        <JobPanel
          jobId={view.id}
          tag={tagByJob.get(view.id) ?? null}
          tagListError={tagError || undefined}
          onTagCreated={noteTagCreated}
          onRenamed={() => loadDirectory()}
        />
      )}

      {view.kind === "customer" && (
        <CustomerPanel
          accountId={view.id}
          jobs={openCustomer?.jobs ?? allJobs.filter((j) => j.accountId === view.id)}
          onOpenJob={(id) => setView({ kind: "job", id })}
          onSaved={() => loadDirectory()}
        />
      )}

      {view.kind === "list" && (
        <div className="space-y-5">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              loading
                ? "Loading…"
                : `Filter ${directory?.customers.length ?? 0} customers, ${allJobs.length} jobs`
            }
            aria-label="Filter customers and jobs"
          />

          <ChipScroller>
            <FilterChip on={showClosed} onClick={() => setShowClosed((v) => !v)}>
              Closed jobs too
            </FilterChip>
            {/* Offered only once the tag list is in. Without it the filter would
                match nothing and read as "every job has a tag", which is the
                opposite of what an unread list means. */}
            {tags && (
              <FilterChip
                on={needsTagOnly}
                onClick={() => setNeedsTagOnly((v) => !v)}
                title="Jobs whose invoice capture Gmail label does not exist yet"
              >
                Missing a capture tag
                {missingTagJobs.size > 0 ? ` (${missingTagJobs.size})` : ""}
              </FilterChip>
            )}
          </ChipScroller>

          {error && <Banner tone="error">{error}</Banner>}
          {tagError && <Banner tone="warning">Capture tags could not be read: {tagError}</Banner>}
          {tags && tags.unresolved.length > 0 && (
            <Banner tone="warning">
              {tags.unresolved.length} Gmail capture label
              {tags.unresolved.length === 1 ? "" : "s"} match no project, so mail tagged with
              {tags.unresolved.length === 1 ? " it" : " them"} is never filed:{" "}
              {tags.unresolved.join(", ")}
            </Banner>
          )}
          {loading && !directory && <Loading label="Loading the directory…" />}

          {directory && (
            <>
              <section className="space-y-2">
                <SectionHeading
                  trailing={
                    <span className="text-[11px] tabular-nums text-neutral-500">
                      {visible.customers.length}
                    </span>
                  }
                >
                  Customers
                </SectionHeading>
                {visible.customers.length === 0 ? (
                  <EmptyState>
                    {q || needsTagOnly ? "Nothing matches those filters." : "No customers in JobTread."}
                  </EmptyState>
                ) : (
                  <ListCard>
                    {visible.customers.map((c) => (
                      <ListRow
                        key={c.id}
                        onClick={() => setView({ kind: "customer", id: c.id })}
                        label={c.name}
                        desc={[c.contactName, c.address].filter(Boolean).join(" · ")}
                        badge={c.jobs.length > 0 ? <CountBadge n={c.jobs.length} /> : undefined}
                        trailing={c.archivedAt ? <Chip>Archived</Chip> : undefined}
                      />
                    ))}
                  </ListCard>
                )}
              </section>

              <section className="space-y-2">
                <SectionHeading
                  trailing={
                    <span className="text-[11px] tabular-nums text-neutral-500">
                      {visible.jobs.length}
                    </span>
                  }
                >
                  Jobs
                </SectionHeading>
                {visible.jobs.length === 0 ? (
                  <EmptyState>
                    {needsTagOnly
                      ? "Every job that can have a capture tag already has one."
                      : "Nothing matches those filters."}
                  </EmptyState>
                ) : (
                  <ListCard>
                    {visible.jobs.map((j) => (
                      <ListRow
                        key={j.id}
                        onClick={() => setView({ kind: "job", id: j.id })}
                        label={j.customer ? `${j.customer} — ${j.name}` : j.name}
                        desc={jobDesc(j)}
                        trailing={<JobTagChip jobId={j.id} tags={tags} missing={missingTagJobs} />}
                      />
                    ))}
                  </ListCard>
                )}
              </section>

              {directory.orphanJobs.length > 0 && (
                <MetaLine
                  items={[
                    `${directory.orphanJobs.length} job${directory.orphanJobs.length === 1 ? "" : "s"} sit under no customer account — they are in the Jobs list above`,
                  ]}
                />
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
