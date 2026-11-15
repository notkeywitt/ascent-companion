// The year ribbon's three reads. Imported through "@/lib/jobtread".
import type { RibbonRow } from "@/lib/yearRibbon";
import { pageAll, type PaveConfig } from "./core";

/** The vendor the Historical Cost Import bills under. See below. */
const HISTORICAL_VENDOR = "Historical Job Cost";

/**
 * One calendar year of crew minutes, vendor bill cost and client invoice price,
 * per job per ISO week.
 *
 * Both are GROUPED aggregates: JobTread sums server-side and answers a row per
 * (week, job), so a year is a few hundred rows instead of every time entry and
 * every bill. `formatDatetime` takes Postgres patterns; "IW" is the ISO week
 * (confirmed live 2026-11-15). Bills count when pending or approved, the same
 * rule every cost roll-up uses, so a voided (denied) bill is out.
 *
 * Client invoices count the same way (pending or approved) at their price, the
 * figure before tax.
 *
 * The "Historical Job Cost" vendor is out too: its bills are a job's whole
 * pre-JobTread spend in one lump (the Historical Cost Import), dated about
 * April 1, 2026. Counted, one week held $2.1M and flattened every other
 * week of bills (owner's ribbon check, 2026-11-15).
 */
export async function getYearRibbonRows(
  cfg: PaveConfig,
  year: number,
): Promise<{ minutes: RibbonRow[]; bills: RibbonRow[]; invoices: RibbonRow[] }> {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;
  const grouped = (connection: string, dateField: string, sum: string, where: unknown[]) =>
    pageAll<any>(cfg, {
      label: `organization.${connection} (year ribbon)`,
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          [connection]: {
            $: {
              ...args,
              where: { and: [[dateField, ">=", from], [dateField, "<", to], ...where] },
              expressions: { wk: { formatDatetime: [[dateField], "IW"] } },
              group: { by: ["wk", ["job", "id"]], aggs: { total: { sum } } },
            },
            nextPage: {},
            withValues: {},
          },
        },
      }),
      pick: (r) => r?.organization?.[connection],
    });
  const rows = (list: any[]): RibbonRow[] =>
    list.map((r) => ({ week: Number(r?.wk), jobId: String(r?.job?.id ?? ""), value: Number(r?.total) || 0 }));

  const [minutes, bills, invoices] = await Promise.all([
    grouped("timeEntries", "startedAt", "minutes", []),
    grouped("documents", "issueDate", "cost", [
      ["type", "vendorBill"],
      ["status", "in", ["pending", "approved"]],
      [["account", "name"], "!=", HISTORICAL_VENDOR],
    ]),
    grouped("documents", "issueDate", "price", [
      ["type", "customerInvoice"],
      ["status", "in", ["pending", "approved"]],
    ]),
  ]);
  return { minutes: rows(minutes), bills: rows(bills), invoices: rows(invoices) };
}
