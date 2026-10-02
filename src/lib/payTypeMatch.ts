/**
 * WHICH PAY TYPE does this employee get on this job and cost code?
 *
 * The office keeps a list of rules on /labor-rates: employee + job + cost code
 * → pay type. A blank cost code means "any cost code on this job". The most
 * specific rule wins: the exact code first, then the job-wide rule.
 *
 * No imports, so the time page (client) and the routes (server) share it.
 */
export interface PayTypeRule {
  id: number;
  jtUserId: string;
  jobId: string;
  jobName: string;
  /** Cost code NUMBER ("01 31 10"), not a cost item id — cost items are per job. "" = any. */
  costCode: string;
  payType: string;
}

/** The pay type the rules give, or "" when none applies. */
export function matchPayType(
  rules: Pick<PayTypeRule, "jtUserId" | "jobId" | "costCode" | "payType">[],
  pick: { jtUserId: string; jobId: string; costCode: string },
): string {
  if (!pick.jtUserId || !pick.jobId) return "";
  const own = rules.filter((r) => r.jtUserId === pick.jtUserId && r.jobId === pick.jobId);
  const code = pick.costCode.trim();
  return (
    (code && own.find((r) => r.costCode === code)?.payType) || own.find((r) => r.costCode === "")?.payType || ""
  );
}

/** The confirm shown before an employee changes a pay type by hand. */
export const PAY_TYPE_CHANGE_WARNING = "Are you sure you really want to change your pay type for this time entry?";
