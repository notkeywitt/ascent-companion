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

/** An employee's default cost code on one job. */
export interface CostCodeDefault {
  id: number;
  jtUserId: string;
  jobId: string;
  jobName: string;
  costCode: string;
}

/** The cost code NUMBER this employee starts on for this job, or "". */
export function defaultCostCode(
  defaults: Pick<CostCodeDefault, "jtUserId" | "jobId" | "costCode">[],
  pick: { jtUserId: string; jobId: string },
): string {
  if (!pick.jtUserId || !pick.jobId) return "";
  return defaults.find((d) => d.jtUserId === pick.jtUserId && d.jobId === pick.jobId)?.costCode ?? "";
}

/** The confirm shown before an employee changes a pay type by hand. */
export const PAY_TYPE_CHANGE_WARNING = "Are you sure you really want to change your pay type for this time entry?";

/** The pay type every entry starts on. */
export const DEFAULT_PAY_TYPE = "Regular Pay";

/**
 * The pay type the time clock files when no rule applies: Regular Pay. A person
 * whose own list names it differently (a group rate like "Berger Bunkhouse -
 * Regular Pay") gets that one. A person with no Regular Pay at all gets their
 * first pay type, so JobTread does not refuse the entry. An unknown list gets
 * "Regular Pay".
 */
export function defaultPayType(types: string[]): string {
  if (!types.length || types.includes(DEFAULT_PAY_TYPE)) return DEFAULT_PAY_TYPE;
  const want = DEFAULT_PAY_TYPE.toLowerCase();
  return types.find((t) => t.toLowerCase().endsWith(want)) ?? types[0];
}

/**
 * An item's display name for the pickers: the line's own name, else the code's
 * name, with the cost code number removed when the name repeats it
 * ("01 31 20 - General Labor" → "General Labor").
 */
export function itemName(c: { number: string; name: string; detail?: string }): string {
  const raw = (c.detail || c.name || "").trim();
  const code = c.number.trim();
  if (!code) return raw;
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = raw
    .replace(new RegExp(`^${esc}\\s*[-–—:·]?\\s*`), "")
    .replace(new RegExp(`\\s*[-–—:·(]?\\s*${esc}\\)?$`), "")
    .trim();
  return stripped || raw;
}
