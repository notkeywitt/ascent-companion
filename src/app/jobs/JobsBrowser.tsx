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
}

interface Leaf {
  name: string | null;
  cost: number | null;
  document: { id: string; type: string | null; status: string | null } | null;
  costCode: {
    number: string | null;
    name: string | null;
    parentCostCode: { number: string | null; name: string | null } | null;
  } | null;
}

interface DivisionRow {
  division: string; // 2-digit CSI division, e.g. "01"
  name: string; // JobTread's division name (parent cost code), e.g. "General Requirements"
  budget: number; // Σ budget-leaf cost (document == null)
  actual: number; // Σ approved vendor-bill line cost coded to this division
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Customer - Job", or just the job name when the customer is unknown. */
const jobLabel = (j: Job) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

/** Sentinel value for the "jobs with no Status set" filter option. */
const NO_STATUS = "__no_status__";

/**
 * Map of jobId → "Status" custom-field value, fetched on its own. We can't nest
 * customFieldValues inside the paged organization.jobs connection — that 413s
 * ("Request Entity Too Large", the 413 rule in JT_API_REFERENCE.md) — so we look
 * up the Status field once and page its values (each keyed to its job).
 */
async function loadStatusMap(orgId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const cf = await gatewayQuery<{
    organization: {
      customFields: { nodes: Array<{ id: string; name: string | null; targetType: string | null }> };
    };
  }>({
    organization: {
      $: { id: orgId },
      customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, targetType: {} } },
    },
  });
  const fields = cf.organization.customFields.nodes;
  const field =
    fields.find((f) => f.name === "Status" && f.targetType === "job") ??
    fields.find((f) => f.name === "Status");
  if (!field) return map;

  let page: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await gatewayQuery<{
      customField: {
        customFieldValues: {
          nextPage: string | null;
          nodes: Array<{ value: unknown; job: { id: string } | null }>;
        };
      };
    }>({
      customField: {
        $: { id: field.id },
        customFieldValues: {
          $: { size: 100, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: { value: {}, job: { id: {} } },
        },
      },
    });
    const conn = r.customField.customFieldValues;
    for (const v of conn.nodes) {
      if (v.job?.id && v.value != null) {
        map.set(v.job.id, typeof v.value === "string" ? v.value : String(v.value));
      }
    }
    if (!conn.nextPage) break;
    page = conn.nextPage;
  }
  return map;
}

export function JobsBrowser({ orgId }: { orgId: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [selected, setSelected] = useState<Job | null>(null);
  const [rows, setRows] = useState<DivisionRow[] | null>(null);
  const [budgetTotal, setBudgetTotal] = useState(0);
  const [actualTotal, setActualTotal] = useState(0);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  // Load jobs, then merge in their Status. Two phases on purpose: nesting
  // customFieldValues inside the paged jobs connection 413s, so Status is fetched
  // separately (loadStatusMap) and joined by job id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Phase 1 — jobs (light), paging the cursor past the 100 cap.
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
                },
              },
            },
          });
          const conn = r.organization.jobs;
          for (const n of conn.nodes) {
            all.push({
              id: n.id,
              name: n.name,
              number: n.number,
              customer: n.location?.account?.name ?? null,
              status: null,
            });
          }
          if (!conn.nextPage) break;
          page = conn.nextPage;
        }

        // Phase 2 — the "Status" custom field, keyed by job id.
        const statusMap = await loadStatusMap(orgId);
        for (const j of all) j.status = statusMap.get(j.id) ?? null;

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
                document: { id: {}, type: {}, status: {} },
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
      // One pass over every cost item on the job, rolled up by CSI division
      // (first two digits of the cost-code number) and labeled with JobTread's
      // own division name (the parent cost code). BUDGET = leaves with no
      // document (skip JT's "Uncategorized <code>" rollups); ACTUAL = lines on
      // APPROVED vendor bills.
      const groups = new Map<string, DivisionRow>();
      const bump = (l: Leaf, field: "budget" | "actual") => {
        const digits = (l.costCode?.number ?? "").replace(/\D/g, "");
        const division = digits ? digits.slice(0, 2) : "—";
        const parent = l.costCode?.parentCostCode;
        const name = parent?.name ?? parent?.number ?? (division === "—" ? "Uncategorized" : "");
        const g = groups.get(division) ?? { division, name, budget: 0, actual: 0 };
        if (!g.name && name) g.name = name; // fill from the first item that has one
        g[field] += l.cost ?? 0;
        groups.set(division, g);
      };
      for (const l of leaves) {
        const doc = l.document;
        if (!doc) {
          if (!/^uncategorized\b/i.test(l.name ?? "")) bump(l, "budget");
        } else if (doc.type === "vendorBill" && doc.status === "approved") {
          bump(l, "actual");
        }
      }
      const out = [...groups.values()].sort((a, b) => a.division.localeCompare(b.division));
      setRows(out);
      setBudgetTotal(out.reduce((s, r2) => s + r2.budget, 0));
      setActualTotal(out.reduce((s, r2) => s + r2.actual, 0));
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
                                <SectionLabel className="mb-2">
                                  Budget vs. actual by division
                                </SectionLabel>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-neutral-200 text-[11px] uppercase tracking-wide text-neutral-400 dark:border-neutral-700/60">
                                        <th className="py-1 pr-2 text-left font-semibold" colSpan={2}>
                                          Division
                                        </th>
                                        <th className="py-1 pr-2 text-right font-semibold">Budget</th>
                                        <th className="py-1 text-right font-semibold">Actual</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map((r) => {
                                        const over = r.budget > 0 && r.actual > r.budget;
                                        return (
                                          <tr
                                            key={r.division}
                                            className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                                          >
                                            <td className="whitespace-nowrap py-1.5 pr-2 align-top font-mono text-xs text-neutral-500">
                                              {r.division}
                                            </td>
                                            <td className="py-1.5 pr-2">{r.name}</td>
                                            <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                                              {money(r.budget)}
                                            </td>
                                            <td
                                              className={`whitespace-nowrap py-1.5 text-right tabular-nums ${over ? "font-semibold text-red-600 dark:text-red-400" : ""}`}
                                            >
                                              {money(r.actual)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t-2 border-neutral-300 dark:border-neutral-600">
                                        <td className="py-1.5 pr-2 font-semibold" colSpan={2}>
                                          Total
                                        </td>
                                        <td className="whitespace-nowrap py-1.5 pr-2 text-right font-semibold tabular-nums">
                                          {money(budgetTotal)}
                                        </td>
                                        <td
                                          className={`whitespace-nowrap py-1.5 text-right font-semibold tabular-nums ${
                                            budgetTotal > 0 && actualTotal > budgetTotal
                                              ? "text-red-600 dark:text-red-400"
                                              : ""
                                          }`}
                                        >
                                          {money(actualTotal)}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                                <p className="mt-2 text-[11px] text-neutral-400">
                                  Actual = approved vendor bills. Over-budget divisions are in red.
                                </p>
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
