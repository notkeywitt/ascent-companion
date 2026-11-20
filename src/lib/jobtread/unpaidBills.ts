// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pageAll, type PaveConfig, PaveTooManyPagesError } from "./core";
import { isExpenseDoc } from "./billIngestion";
import type { UnpaidBillInput } from "@/lib/unpaidBills";

/**
 * READ — every vendor bill (Bills and Expenses) issued on or after `from`
 * (YYYY-MM-DD), draft, pending or approved. Voided bills (`denied`) are left
 * out. Paid or not is decided by `buildUnpaidBills`: Pave cannot filter on
 * amountPaid. Same query shape and fallback as `getAllBillsForMonth`.
 */
export async function getUnpaidBillsSince(cfg: PaveConfig, from: string): Promise<UnpaidBillInput[]> {
  const q = (nodes: Record<string, unknown>, args: Record<string, unknown>) => ({
    organization: {
      $: { id: cfg.orgId },
      id: {},
      documents: {
        $: {
          where: {
            and: [
              ["type", "vendorBill"],
              ["status", "in", ["draft", "pending", "approved"]],
              ["issueDate", ">=", from],
            ],
          },
          ...args,
        },
        nextPage: {},
        nodes,
      },
    },
  });
  const base = {
    id: {},
    cost: {},
    status: {},
    issueDate: {},
    createdAt: {},
    fromName: {},
    name: {},
    amountPaid: {},
    balance: {},
  };
  const rich = {
    ...base,
    qboDocumentType: {},
    account: { name: {} },
    job: { id: {}, name: {}, location: { account: { name: {} } } },
  };
  const min = { ...base, job: { id: {}, name: {} } };

  const walkWith = (nodes: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: "organization.documents (unpaid bills since a date)",
      size: 25,
      query: (args) => q(nodes, args),
      pick: (r) => r?.organization?.documents,
    });
  const raw = await walkWith(rich).catch((e) => {
    if (e instanceof PaveTooManyPagesError) throw e;
    return walkWith(min);
  });

  return raw.map((b) => ({
    id: String(b.id),
    vendor: String(b.account?.name ?? b.fromName ?? "Vendor"),
    cost: typeof b.cost === "number" ? b.cost : 0,
    issueDate: b.issueDate ?? "",
    createdAt: b.createdAt ?? "",
    status: b.status ?? "",
    amountPaid: typeof b.amountPaid === "number" ? b.amountPaid : 0,
    balance: typeof b.balance === "number" ? b.balance : 0,
    isExpense: isExpenseDoc(b),
    jobName: b.job?.name ?? "",
    customerName: b.job?.location?.account?.name ?? "",
  }));
}
