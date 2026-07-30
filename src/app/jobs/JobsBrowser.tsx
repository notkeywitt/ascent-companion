"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Input, Card, Banner, Loading, EmptyState, SectionLabel } from "@/components/ui";
import { gatewayQuery } from "@/lib/paveGatewayClient";

/**
 * Jobs browser driven entirely by the guarded Pave gateway (gatewayQuery). Lists
 * the org's jobs and, on tap, loads a job's budget grouped by cost code — using
 * only queries composed from JT_API_REFERENCE.md, no per-view API route.
 */

interface Job {
  id: string;
  name: string;
  number: string | null;
}

interface Leaf {
  id: string;
  name: string | null;
  cost: number | null;
  costCode: { number: string | null; name: string | null } | null;
  document: { id: string } | null;
}

interface BudgetRow {
  code: string;
  name: string;
  cost: number;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function JobsBrowser({ orgId }: { orgId: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [selected, setSelected] = useState<Job | null>(null);
  const [rows, setRows] = useState<BudgetRow[] | null>(null);
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
            organization: { jobs: { nextPage: string | null; nodes: Job[] } };
          }>({
            organization: {
              $: { id: orgId },
              jobs: {
                $: { size: 100, ...(page ? { page } : {}) },
                nextPage: {},
                nodes: { id: {}, name: {}, number: {} },
              },
            },
          });
          const conn = r.organization.jobs;
          all.push(...conn.nodes);
          if (!conn.nextPage) break;
          page = conn.nextPage;
        }
        all.sort((a, b) => a.name.localeCompare(b.name));
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
                id: {},
                name: {},
                cost: {},
                document: { id: {} },
                costCode: { number: {}, name: {} },
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
      const groups = new Map<string, BudgetRow>();
      for (const l of budget) {
        const code = l.costCode?.number ?? "—";
        const name = l.costCode?.name ?? "Uncategorized";
        const g = groups.get(code) ?? { code, name, cost: 0 };
        g.cost += l.cost ?? 0;
        groups.set(code, g);
      }
      const out = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
      setRows(out);
      setBudgetTotal(out.reduce((s, r2) => s + r2.cost, 0));
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : "Failed to load budget");
    } finally {
      setBudgetLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) => j.name.toLowerCase().includes(q) || (j.number ?? "").toLowerCase().includes(q),
    );
  }, [jobs, filter]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader title="Jobs" description="Browse jobs and their budget by cost code." />

      {jobsError && (
        <Banner tone="error" className="mb-4">
          {jobsError}
        </Banner>
      )}

      {!jobs && !jobsError && <Loading label="Loading jobs…" />}

      {jobs && (
        <>
          <Input
            type="search"
            placeholder="Search jobs by name or number…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-3"
          />

          {filtered.length === 0 ? (
            <EmptyState>No jobs match your search.</EmptyState>
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
                          <span className="block truncate text-sm font-semibold">{j.name}</span>
                          {j.number && (
                            <span className="block text-xs text-neutral-500">#{j.number}</span>
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
                                <SectionLabel className="mb-2">Budget by cost code</SectionLabel>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <tbody>
                                      {rows.map((r) => (
                                        <tr
                                          key={r.code}
                                          className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                                        >
                                          <td className="whitespace-nowrap py-1.5 pr-2 align-top font-mono text-xs text-neutral-500">
                                            {r.code}
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
            {jobs.length} job{jobs.length === 1 ? "" : "s"} · live from JobTread via the Pave gateway
          </p>
        </>
      )}
    </main>
  );
}
