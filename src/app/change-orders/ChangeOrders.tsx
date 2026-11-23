"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterIconButton, SortIconButton } from "@/components/FilterSortButtons";
import { Button, Card, EmptyState, Label, Loading, MetaLine, PageHeader, Segmented, Select } from "@/components/ui";
import {
  STATUS_LABEL,
  groupLog,
  jtDocUrl,
  type CoGroup,
  type CoRow,
  type CoSort,
  type CoStatus,
} from "@/lib/changeOrders";
import { money } from "@/lib/money";
import { NewChangeOrder } from "./NewChangeOrder";

type Job = { id: string; name: string; customer?: string | null };
const jobLabel = (j: Job) => (j.customer ? `${j.customer} - ${j.name}` : j.name);
const dateOf = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

const SORT_OPTIONS: { value: CoSort; label: string }[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount", label: "Amount" },
  { value: "job", label: "Job" },
];

/**
 * The change-order log: /change-orders (every job, grouped by job) and the Jobs
 * page's Change Orders tab (`jobId` set: that job only). Labels only — no
 * subtitle or description (owner, 2026-11-23).
 */
export function ChangeOrders({ jobId }: { jobId?: string }) {
  const [rows, setRows] = useState<CoRow[] | null>(null);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [status, setStatus] = useState<CoStatus | "">("");
  const [jobFilter, setJobFilter] = useState("");
  const [sort, setSort] = useState<CoSort>("recent");
  const [group, setGroup] = useState<CoGroup>(jobId ? "none" : "job");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError("");
    fetch(`/api/change-orders${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ""}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setRows(d.rows ?? [])))
      .catch(() => setError("Could not load the change orders."));
  }, [jobId]);
  useEffect(load, [load]);

  useEffect(() => {
    if (jobId) return;
    let cancelled = false;
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => !cancelled && setJobs(d.error ? [] : (d.jobs ?? [])))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const groups = useMemo(
    () => (rows ? groupLog(rows, { status, jobId: jobId ? "" : jobFilter }, sort, group) : []),
    [rows, status, jobFilter, jobId, sort, group],
  );
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const filters = (status ? 1 : 0) + (jobFilter && !jobId ? 1 : 0);
  const logJobs = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) m.set(r.jobId, r.customer ? `${r.customer} - ${r.jobName}` : r.jobName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const newButton = (
    <Button onClick={() => setCreating(true)} className="min-h-11">
      New CO
    </Button>
  );

  return (
    <div className={jobId ? "space-y-3" : "mx-auto max-w-2xl space-y-4 p-4"}>
      {jobId ? <div className="flex justify-end">{newButton}</div> : <PageHeader title="Change Orders" actions={newButton} />}

      {error ? (
        <EmptyState>{error}</EmptyState>
      ) : !rows ? (
        <Loading />
      ) : (
        <Card pad={false} className="overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {shown} change order{shown === 1 ? "" : "s"}
            </span>
            <FilterIconButton
              open={filterOpen}
              onClick={() => setFilterOpen((o) => !o)}
              label="Filter change orders"
              count={filters}
            />
            <SortIconButton open={sortOpen} onClick={() => setSortOpen((o) => !o)} label="Sort change orders" />
          </div>

          {sortOpen && (
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-line-soft bg-neutral-50 px-3 py-2 dark:bg-ink-raised/50">
              <div className="min-w-[9rem] flex-1">
                <Label htmlFor="co-sort">Sort</Label>
                <Select id="co-sort" value={sort} onChange={(e) => setSort(e.target.value as CoSort)}>
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Group</Label>
                <Segmented
                  label="Group"
                  value={group}
                  onChange={setGroup}
                  options={[
                    ...(jobId ? [] : [{ value: "job" as const, label: "Job" }]),
                    { value: "status" as const, label: "Status" },
                    { value: "none" as const, label: "None" },
                  ]}
                />
              </div>
            </div>
          )}

          {filterOpen && (
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-line-soft bg-neutral-50 px-3 py-2 dark:bg-ink-raised/50">
              <div className="min-w-[9rem] flex-1">
                <Label htmlFor="co-status">Status</Label>
                <Select id="co-status" value={status} onChange={(e) => setStatus(e.target.value as CoStatus | "")}>
                  <option value="">All</option>
                  {(Object.keys(STATUS_LABEL) as CoStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>
              {!jobId && (
                <div className="min-w-[12rem] flex-1">
                  <Label htmlFor="co-job">Job</Label>
                  <Select id="co-job" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
                    <option value="">All jobs</option>
                    {logJobs.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}

          {shown === 0 ? (
            <div className="border-t border-line-soft px-3 py-6 text-center text-sm text-neutral-500">No change orders</div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="border-t border-line-soft">
                {group !== "none" && (
                  <div className="flex items-baseline gap-2 bg-neutral-50 px-3 py-2 dark:bg-ink-raised/50">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.label}</span>
                    <MetaLine
                      items={[
                        g.approved ? `Approved ${money(g.approved)}` : null,
                        g.open ? `Open ${money(g.open)}` : null,
                      ]}
                    />
                  </div>
                )}
                <ul className="divide-y divide-line-soft">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <a
                        href={jtDocUrl(r.jobId, r.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center gap-3 px-3 py-2 transition hover:bg-neutral-50 dark:hover:bg-white/5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            CO #{r.number}
                            {r.title ? ` · ${r.title}` : ""}
                          </span>
                          <MetaLine
                            items={[
                              <span key="s" className={r.status === "approved" ? "text-ok" : r.status === "denied" ? "text-danger" : ""}>
                                {STATUS_LABEL[r.status]}
                              </span>,
                              dateOf(r.createdAt),
                              group !== "job" && !jobId ? (r.customer ? `${r.customer} - ${r.jobName}` : r.jobName) : null,
                            ]}
                          />
                        </span>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${r.status === "denied" ? "line-through opacity-60" : ""}`}>
                          {money(r.price)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Card>
      )}

      {creating && (
        <NewChangeOrder
          jobId={jobId}
          jobs={jobs.map((j) => ({ id: j.id, label: jobLabel(j) }))}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}
