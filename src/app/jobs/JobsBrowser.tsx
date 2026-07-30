"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PageHeader,
  Input,
  Select,
  Card,
  Banner,
  Loading,
  EmptyState,
  SectionLabel,
} from "@/components/ui";
import { gatewayQuery } from "@/lib/paveGatewayClient";

/**
 * Jobs browser driven entirely by the guarded Pave gateway (gatewayQuery). Lists
 * the org's jobs as "Customer - Job", filterable by the "Status" custom field,
 * and on tap loads a job's budget rolled up by CSI division (first two digits of
 * the cost code) — using only queries composed from JT_API_REFERENCE.md, no
 * per-view API route.
 */

interface Job {
  id: string;
  name: string;
  number: string | null;
  customer: string | null;
  status: string | null; // the "Status" job custom field (New Lead / Awarded / …)
}

interface RawJob {
  id: string;
  name: string;
  number: string | null;
  location: { account: { name: string | null } | null } | null;
  customFieldValues: {
    nodes: Array<{ value: unknown; customField: { name: string | null } | null }>;
  } | null;
}

interface Leaf {
  name: string | null;
  cost: number | null;
  document: { id: string } | null;
  costCode: {
    number: string | null;
    name: string | null;
    parentCostCode: { number: string | null; name: string | null } | null;
  } | null;
}

interface DivisionRow {
  division: string; // 2-digit CSI division, e.g. "01"
  name: string; // JobTread's division name (parent cost code), e.g. "General Requirements"
  cost: number;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Customer - Job", or just the job name when the customer is unknown. */
const jobLabel = (j: Job) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

/** Sentinel value for the "jobs with no Status set" filter option. */
const NO_STATUS = "__no_status__";

export function JobsBrowser({ orgId }: { orgId: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [selected, setSelected] = useState<Job | null>(null);
  const [rows, setRows] = useState<DivisionRow[] | null>(null);
  const [budgetTotal, setBudgetTotal] = useState(0);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  // Load the job list once, paging the cursor (org can exceed the 100 cap).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all: Job[] = [];
        let page: string | undefined;
        for (let i = 0; i < 10; i++) {
          const r = await gatewayQuery<{
            organization: { jobs: { nextPage: string | null; nodes: RawJob[] } };
          }>({
            organization: {
              $: { id: orgId },
              jobs: {
                $: { size: 100, ...(page ? { page } : {}) },
                nextPage: {},
                nodes: {
                  id: {},
                  name: {},
                  number: {},
                  location: { account: { name: {} } },
                  customFieldValues: {
                    $: { size: 30 },
                    nodes: { value: {}, customField: { name: {} } },
                  },
                },
              },
            },
          });
          const conn = r.organization.jobs;
          for (const n of conn.nodes) {
            const statusRaw = n.customFieldValues?.nodes.find(
              (v) => v.customField?.name === "Status",
            )?.value;
            all.push({
              id: n.id,
              name: n.name,
              number: n.number,
              customer: n.location?.account?.name ?? null,
              status:
                typeof statusRaw === "string"
                  ? statusRaw
                  : statusRaw == null
                    ? null
                    : String(statusRaw),
            });
          }
          if (!conn.nextPage) break;
          page = conn.nextPage;
        }
        // Sort by the "Customer - Job" label so a customer's jobs group together.
        all.sort((a, b) => jobLabel(a).localeCompare(jobLabel(b)));
        if (!cancelled) setJobs(all);
      } catch (e) {
        if (!cancelled) setJobsError(e instanceof Error ? e.message : "Failed to load jobs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const loadBudget = useCallback(async (job: Job) => {
    setSelected(job);
    setRows(null);
    setBudgetError(null);
    setBudgetLoading(true);
    try {
      // Page the FLAT job.costItems connection (budgets exceed the 100 cap; a
      // single page silently drops leaves — see jt-budget-map-pagination memory).
      const leaves: Leaf[] = [];
      let page: string | undefined;
      for (let i = 0; i < 20; i++) {
        const r = await gatewayQuery<{
          job: { costItems: { nextPage: string | null; nodes: Leaf[] } };
        }>({
          job: {
            $: { id: job.id },
            costItems: {
              $: { size: 100, ...(page ? { page } : {}) },
              nextPage: {},
              nodes: {
                name: {},
                cost: {},
                document: { id: {} },
                costCode: {
                  number: {},
                  name: {},
                  parentCostCode: { number: {}, name: {} },
                },
              },
            },
          },
        });
        const conn = r.job.costItems;
        leaves.push(...conn.nodes);
        if (!conn.nextPage) break;
        page = conn.nextPage;
      }
      // True budget leaves have document == null (bill/estimate lines carry one),
      // and skip JT's auto-created "Uncategorized <code>" rollups (not real budget).
      const budget = leaves.filter(
        (l) => !l.document && !/^uncategorized\b/i.test(l.name ?? ""),
      );
      // Group by CSI division = first two digits of the cost-code number. Label
      // each with JobTread's own division name (the parent cost code, e.g.
      // "01 00 00 General Requirements"), falling back to the parent number.
      const groups = new Map<string, DivisionRow>();
      for (const l of budget) {
        const digits = (l.costCode?.number ?? "").replace(/\D/g, "");
        const division = digits ? digits.slice(0, 2) : "—";
        const parent = l.costCode?.parentCostCode;
        const name = parent?.name ?? parent?.number ?? (division === "—" ? "Uncategorized" : "");
        const g = groups.get(division) ?? { division, name, cost: 0 };
        if (!g.name && name) g.name = name; // fill from the first item that has one
        g.cost += l.cost ?? 0;
        groups.set(division, g);
      }
      const out = [...groups.values()].sort((a, b) => a.division.localeCompare(b.division));
      setRows(out);
      setBudgetTotal(out.reduce((s, r2) => s + r2.cost, 0));
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : "Failed to load budget");
    } finally {
      setBudgetLoading(false);
    }
  }, []);

  // Distinct statuses present, for the dropdown (plus a "(No status)" option
  // when some jobs have none).
  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs ?? []) if (j.status) set.add(j.status);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [jobs]);
  const hasNoStatus = useMemo(() => !!jobs?.some((j) => !j.status), [jobs]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = filter.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter) {
        const statusOk = statusFilter === NO_STATUS ? !j.status : j.status === statusFilter;
        if (!statusOk) return false;
      }
      if (!q) return true;
      return (
        j.name.toLowerCase().includes(q) ||
        (j.customer ?? "").toLowerCase().includes(q) ||
        (j.number ?? "").toLowerCase().includes(q)
      );
    });
  }, [jobs, filter, statusFilter]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader title="Jobs" description="Filter by status; open a job for its budget by CSI division." />

      {jobsError && (
        <Banner tone="error" className="mb-4">
          {jobsError}
        </Banner>
      )}

      {!jobs && !jobsError && <Loading label="Loading jobs…" />}

      {jobs && (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <Input
              type="search"
              placeholder="Search by customer, job, or number…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="sm:flex-1"
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="sm:w-52"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {hasNoStatus && <option value={NO_STATUS}>(No status)</option>}
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState>No jobs match your filters.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {filtered.map((j) => {
                const isSel = selected?.id === j.id;
                return (
                  <li key={j.id}>
                    <Card pad={false}>
                      <button
                        type="button"
                        onClick={() => (isSel ? setSelected(null) : loadBudget(j))}
                        aria-expanded={isSel}
                        className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{jobLabel(j)}</span>
                          {(j.number || j.status) && (
                            <span className="block truncate text-xs text-neutral-500">
                              {j.number ? `#${j.number}` : ""}
                              {j.number && j.status ? " · " : ""}
                              {j.status ?? ""}
                            </span>
                          )}
                        </span>
                        <span
                          aria-hidden
                          className={`shrink-0 text-neutral-400 transition-transform ${isSel ? "rotate-180" : ""}`}
                        >
                          ⌄
                        </span>
                      </button>

                      {isSel && (
                        <div className="border-t border-neutral-200 p-3 dark:border-neutral-700/60">
                          {budgetLoading && <Loading label="Loading budget…" />}
                          {budgetError && <Banner tone="error">{budgetError}</Banner>}
                          {rows &&
                            !budgetLoading &&
                            !budgetError &&
                            (rows.length === 0 ? (
                              <EmptyState>No budget lines on this job.</EmptyState>
                            ) : (
                              <>
                                <SectionLabel className="mb-2">Budget by division</SectionLabel>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <tbody>
                                      {rows.map((r) => (
                                        <tr
                                          key={r.division}
                                          className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                                        >
                                          <td className="whitespace-nowrap py-1.5 pr-2 align-top font-mono text-xs text-neutral-500">
                                            {r.division}
                                          </td>
                                          <td className="py-1.5 pr-2">{r.name}</td>
                                          <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                                            {money(r.cost)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t-2 border-neutral-300 dark:border-neutral-600">
                                        <td className="py-1.5 pr-2" />
                                        <td className="py-1.5 pr-2 font-semibold">Total budget</td>
                                        <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums">
                                          {money(budgetTotal)}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              </>
                            ))}
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-4 text-center text-xs text-neutral-400">
            {filtered.length} of {jobs.length} job{jobs.length === 1 ? "" : "s"} · live from JobTread via the Pave gateway
          </p>
        </>
      )}
    </main>
  );
}
