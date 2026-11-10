// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { cachedRef, pageAll, type PaveConfig } from "./core";

/** One org cost code, with its name — what a person picks from. */
export interface CostCodeRef {
  id: string;
  number: string; // "06 10 00"
  name: string; // "Rough Carpentry"
}

/**
 * Every ACTIVE cost code in the org, sorted by number. The org has ~180; codes
 * change rarely, so the list is cached for an hour. Archived codes are left out:
 * a person should not pick one. Fields probed live 2026-11-10.
 */
export function getCostCodes(cfg: PaveConfig): Promise<CostCodeRef[]> {
  return cachedRef(`costCodes:${cfg.orgId}`, 60 * 60_000, async () => {
    const rows = await pageAll<any>(cfg, {
      label: "organization.costCodes",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          costCodes: {
            $: { where: { and: [["isActive", true]] }, ...args },
            nextPage: {},
            nodes: { id: {}, number: {}, name: {} },
          },
        },
      }),
      pick: (r) => r?.organization?.costCodes,
    });
    return rows
      .filter((n) => n?.id)
      .map((n) => ({ id: n.id, number: n.number ?? "", name: n.name ?? "" }))
      .sort((a, b) => a.number.localeCompare(b.number) || a.name.localeCompare(b.name));
  });
}
