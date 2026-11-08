// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pageAll, pave, type PaveConfig } from "./core";
// ---------------------------------------------------------------------------
// JOB ACCESS  (the people listed on a JobTread job — "Direct Access")
// ---------------------------------------------------------------------------

/**
 * One open job, and whether a membership is on its access list. An employee must
 * be on a job's list before JobTread lets them clock in to it. Each entry is an
 * `ace` with `job` set — the same shape as Document Access below (confirmed live
 * 2026-10-16: Bunkhouse lists Casey, Cedar, Bret and the rest as job aces).
 */
export interface JobAccessRow {
  id: string;
  name: string;
  number: string;
  customer: string;
  hasAccess: boolean;
}

/**
 * Every OPEN job (`closedOn` null — the same set as `getJobs`), each marked with
 * whether `membershipId` is on it. The nested `aces` is filtered to that one
 * membership with size 1, so it adds one tiny node per job, not a list.
 */
export async function getJobAccessFor(cfg: PaveConfig, membershipId: string): Promise<JobAccessRow[]> {
  const rows = await pageAll(cfg, {
    label: "organization.jobs (access)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        jobs: {
          $: { ...args, where: ["closedOn", null] },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            number: {},
            location: { account: { name: {} } },
            aces: { $: { where: [["membership", "id"], membershipId], size: 1 }, nodes: { id: {} } },
          },
        },
      },
    }),
    pick: (r) => r?.organization?.jobs,
  });
  return rows
    .map((j: any) => ({
      id: String(j.id),
      name: j.name ?? "",
      number: j.number ?? "",
      customer: j?.location?.account?.name ?? "",
      hasAccess: (j?.aces?.nodes ?? []).length > 0,
    }))
    .sort((a, b) => a.customer.localeCompare(b.customer) || a.name.localeCompare(b.name));
}

/**
 * WRITE — put one membership on one job's access list. `notify: false`: "all
 * active jobs" is ~30 jobs, and the default would email the employee once per job.
 * Same bare `{ membershipId }` assignee as `grantDocumentAccess`.
 */
export async function grantJobAccess(cfg: PaveConfig, jobId: string, membershipId: string): Promise<void> {
  await pave(cfg, {
    createAce: {
      $: { assignee: { membershipId }, targetId: jobId, targetType: "job", notify: false },
    },
  });
}
