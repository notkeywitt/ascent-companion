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
 * Master gate for ALL writes to JobTread.
 *
 * ⚠️ THIS IS ARMED IN PRODUCTION and has been for some time. Coding saves, bill
 * creation, invoicing, time entries and leave posting are all live writes to the
 * real JobTread org. Treat any code path behind this gate as reaching production
 * data — because it does.
 *
 * It reads `false` in `.env.example` only because that is a safe default for a
 * dev machine (which points at the same live org). That is a local default, NOT
 * a description of production. The previous comment here said "off by default…
 * until we've coordinated with the AppSheet→JobTread flow" — AppSheet retired
 * 2026-07-10, so that precondition was met long ago, and the stale note had
 * every fresh session concluding writes were disabled.
 *
 * NOT to be confused with gatewayWritesEnabled() below — a SECOND, narrower gate
 * covering only the generic /api/pave endpoint.
 */
export function writesEnabled(): boolean {
  // Tolerate casing/whitespace ("True", " true ") — a common env-var slip.
  return String(process.env.COMPANION_WRITES_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * SECOND gate, specific to the generic /api/pave gateway, and a DIFFERENT env
 * var from the master switch above. Because that endpoint can run ANY mutation
 * the caller composes, it is triple-locked: a write through it needs BOTH
 * writesEnabled() (the org-wide switch — armed in prod) AND this one, AND the
 * mutation must be on the caller's per-role allowlist (src/lib/paveGateway.ts).
 *
 * This one ships default-off so the gateway is read-only until the write
 * allowlist has been reviewed with the owner. Whether it is armed in production
 * is a Vercel env setting and is NOT knowable from this repo — check Vercel
 * rather than inferring it from this file. Flip
 * COMPANION_GATEWAY_WRITES_ENABLED to "true" to arm gateway writes.
 *
 * The bespoke typed routes (coding, add-bill, invoicing, time) do NOT go through
 * this gate — they are governed by writesEnabled() alone, which is armed.
 */
export function gatewayWritesEnabled(): boolean {
  return String(process.env.COMPANION_GATEWAY_WRITES_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Where approved PTO/sick leave posts as a JobTread time entry. Defaults point
 * at the "Office" overhead job (22PXevQbM9FQ = CONFIG.JOBTREAD.DEFAULT_JOB_ID in
 * appscript) and its two $0/hr leave budget leaves, all CONFIRMED live against
 * the Pave API 2026-07-28:
 *   jobId 22PXevQbM9FQ  "Office"
 *   pto   22PbfNY675d6  costCode 88 10 00 "PTO - Request"
 *   sick  22PbfNY675d7  costCode 88 20 00 "Sick Time - Request"
 * (both leaves have document:null → real budget leaves, valid jobCostItemIds.)
 * Pay type resolves in this order (see resolveLeavePayType in leaveService):
 *   1. the employee's roster "Leave Pay Type" (per-worker override, if set)
 *   2. the by-leave-type default below — PTO → "Paid time off", Sick →
 *      "Sick Pay" (the org's two dedicated leave pay types, confirmed live)
 *   3. the optional org-wide LEAVE_PAY_TYPE fallback
 * So no per-employee setup is needed for leave to post at the right category.
 * With the cost items now mapped, `leavePostingReady` is true — but the master
 * `writesEnabled()` gate still independently decides whether anything is
 * actually written to JobTread. Env vars override any default.
 */
export interface LeaveJobConfig {
  jobId: string;
  payType: string; // optional org-wide fallback only (last resort)
  payTypeByLeave: { sick: string; pto: string }; // default JT pay type per leave type
  costItemId: { sick: string; pto: string };
}
export function getLeaveConfig(): LeaveJobConfig {
  return {
    jobId: process.env.LEAVE_JOB_ID ?? "22PXevQbM9FQ",
    payType: process.env.LEAVE_PAY_TYPE ?? "",
    payTypeByLeave: {
      sick: process.env.LEAVE_SICK_PAY_TYPE ?? "Sick Pay",
      pto: process.env.LEAVE_PTO_PAY_TYPE ?? "Paid time off",
    },
    costItemId: {
      sick: process.env.LEAVE_SICK_COST_ITEM_ID ?? "22PbfNY675d7",
      pto: process.env.LEAVE_PTO_COST_ITEM_ID ?? "22PbfNY675d6",
    },
  };
}
/** True when a leave type has the job + budget cost item mapped. The pay type is
 *  checked per-employee at post time, so it isn't part of this gate. */
export function leavePostingReady(leaveType: "sick" | "pto"): boolean {
  const c = getLeaveConfig();
  return Boolean(c.jobId && c.costItemId[leaveType]);
}
