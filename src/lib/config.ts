import type { PaveConfig } from "./jobtread";

/** Server-side Pave config from env. Never import this into client components. */
export function getPaveConfig(): PaveConfig {
  return {
    grantKey: process.env.JT_GRANT_KEY ?? "",
    orgId: process.env.JT_ORG_ID ?? "",
    companyName: process.env.JT_COMPANY_NAME ?? "Ascent Building Co.",
  };
}

export function hasGrant(): boolean {
  return Boolean(process.env.JT_GRANT_KEY);
}

/**
 * Master gate for ALL writes to JobTread. Off by default. Only flip to "true"
 * once we've coordinated with the existing AppSheet→JobTread flow so the two
 * systems don't fight over the same bills.
 */
export function writesEnabled(): boolean {
  // Tolerate casing/whitespace ("True", " true ") — a common env-var slip.
  return String(process.env.COMPANION_WRITES_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Where approved PTO/sick leave posts as a JobTread time entry. Filled in from
 * the appscript `probeLeaveTimeEntry` output once the $0/hr cost codes (PTO
 * 88 10 00, Sick 88 20 00) and their $0 budget lines exist on the leave job.
 * `jobId` defaults to the Office/overhead job; the per-type cost-item ids and
 * pay type have no safe default, so leave posting stays off (see
 * `leavePostingReady`) until they're set — separate from the master write gate.
 */
export interface LeaveJobConfig {
  jobId: string;
  payType: string;
  costItemId: { sick: string; pto: string };
}
export function getLeaveConfig(): LeaveJobConfig {
  return {
    jobId: process.env.LEAVE_JOB_ID ?? "22PXevQbM9FQ",
    payType: process.env.LEAVE_PAY_TYPE ?? "",
    costItemId: {
      sick: process.env.LEAVE_SICK_COST_ITEM_ID ?? "",
      pto: process.env.LEAVE_PTO_COST_ITEM_ID ?? "",
    },
  };
}
/** True when a given leave type has everything needed to post to JobTread. */
export function leavePostingReady(leaveType: "sick" | "pto"): boolean {
  const c = getLeaveConfig();
  return Boolean(c.jobId && c.payType && c.costItemId[leaveType]);
}
