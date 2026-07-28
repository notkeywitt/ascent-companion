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
 * Where approved PTO/sick leave posts as a JobTread time entry. `costItemId`s
 * come from the appscript `probeLeaveTimeEntry` output (the PTO 88 10 00 / Sick
 * 88 20 00 budget leaves). `jobId` defaults to the Office/overhead job. The pay
 * type is PER-EMPLOYEE (JT pay types are per-worker), set on each roster row's
 * "Leave Pay Type"; `payType` here is only an optional org-wide fallback
 * (LEAVE_PAY_TYPE) for anyone whose row is blank. Posting stays off until the
 * cost-item ids are set (see `leavePostingReady`) — separate from the master
 * write gate.
 */
export interface LeaveJobConfig {
  jobId: string;
  payType: string; // optional fallback only; per-employee pay type wins
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
/** True when a leave type has the job + budget cost item mapped. The pay type is
 *  checked per-employee at post time, so it isn't part of this gate. */
export function leavePostingReady(leaveType: "sick" | "pto"): boolean {
  const c = getLeaveConfig();
  return Boolean(c.jobId && c.costItemId[leaveType]);
}
