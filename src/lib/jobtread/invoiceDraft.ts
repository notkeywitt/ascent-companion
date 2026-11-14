// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { COMPANY_TZ, billingMonthEnd } from "@/lib/billing";
import { pageAll, pave, type PaveConfig } from "./core";
import type { UninvoicedBills } from "./invoiceStaging";
import { getUninvoicedBills } from "./sunsetStatements";

// ---------------------------------------------------------------------------
// DRAFT CUSTOMER INVOICE — "Create draft invoice" on Tracking Sheets. Builds
// the month's client invoice from the SAME data the invoice preview reads
// (getUninvoicedBills), in the shape JobTread's own builder leaves: division →
// code → one group per bill (or per day of time) → lines, priced at cost ×
// markup and referencing every bill and time entry it pulls. The live shape is
// scripts/probe-invoice-create.mjs (2026-11-13). It stays a draft: the office
// reviews and sends it in JobTread.
// ---------------------------------------------------------------------------

/** One of the org's template names — JobTread refuses any other name. */
export const INVOICE_DRAFT_NAME = "Monthly Invoice";
/** What the "Monthly Invoice" template gives a draft JobTread builds. */
export const INVOICE_DRAFT_DUE_DAYS = 15;

/** One line of an open vendor bill, as JobTread holds it. */
export interface DraftBillLine {
  billId: string;
  name: string;
  description: string | null;
  quantity: number;
  unitCost: number;
  cost: number;
  isTaxable: boolean;
  /** The budget leaf. A line without one is refused, never guessed. */
  jobCostItemId: string | null;
  costCodeId: string | null;
  code: string;
  codeName: string;
  costTypeId: string | null;
  unitId: string | null;
}
/** A budget leaf a time entry is coded to. */
export interface DraftLeaf {
  id: string;
  name: string;
  costCodeId: string | null;
  code: string;
  codeName: string;
  costTypeId: string | null;
  unitId: string | null;
}
export interface InvoiceDraftSource {
  jobId: string;
  year: number;
  month: number;
  uninvoiced: UninvoicedBills;
  billLines: DraftBillLine[];
  leaves: Record<string, DraftLeaf>;
  header: {
    fromName: string;
    fromAddress: string | null;
    toName: string;
    toAddress: string | null;
    jobLocationName: string;
    jobLocationAddress: string;
    taxRate: number;
  };
}
export interface InvoiceDraftPlan {
  input: Record<string, any>;
  billIds: string[];
  timeEntryIds: string[];
  /** The draft's price before tax — equals the preview's total + fee. */
  price: number;
}

// The same rounding as the preview's fee (getUninvoicedBills).
const r2 = (n: number) => Math.round(n * 100 + 1e-6) / 100;
const isCsi = (code: string) => /^\d{2} \d{2} \d{2}$/.test(code);
const dayOf = (startedAt: string) => new Date(startedAt).toLocaleDateString("en-CA", { timeZone: COMPANY_TZ });
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * PURE — the `createDocument` input for one job and billing month. Throws, with
 * a message for the office, when there is nothing to invoice, when a line has
 * no budget leaf, or when the draft would not total what the preview shows.
 */
export function buildInvoiceDraft(src: InvoiceDraftSource): InvoiceDraftPlan {
  const { uninvoiced: u, header } = src;
  const markup = u.invoice?.markup ?? 1;
  const divisions = u.invoice?.divisions ?? {};
  const jobName = u.job?.name ?? "";
  const bills = u.lines.flatMap((l) =>
    (l.bills ?? []).map((b) => ({ ...b, vendor: l.isSunset ? "Sunset Builders Supply" : l.label })),
  );
  const entries = u.lines.find((l) => l.key === "time")?.timeEntries ?? [];
  if (!bills.length && !entries.length) {
    throw new Error("Nothing to invoice: this month has no approved bill or time entry that is not already on an invoice.");
  }

  // division label → code label → group key → group. "" skips a level.
  const tree = new Map<string, Map<string, Map<string, { name: string; description?: string; lineItems: any[] }>>>();
  const groupFor = (code: string, codeName: string, key: string, name: string, description?: string) => {
    const div = isCsi(code) ? `${code.slice(0, 2)} 00 00` : "";
    const divLabel = div ? `${div} ${divisions[div] ?? ""}`.trim() : "";
    const codeLabel = code ? `${code} ${codeName}`.trim() : "";
    if (!tree.has(divLabel)) tree.set(divLabel, new Map());
    const codes = tree.get(divLabel)!;
    if (!codes.has(codeLabel)) codes.set(codeLabel, new Map());
    const groups = codes.get(codeLabel)!;
    if (!groups.has(key)) groups.set(key, { name, ...(description ? { description } : {}), lineItems: [] });
    return groups.get(key)!;
  };
  const costItem = (
    name: string,
    leaf: { costCodeId: string | null; costTypeId: string | null; unitId: string | null },
    jobCostItemId: string,
    quantity: number,
    cost: number,
    price: number,
    isTaxable: boolean,
    description?: string | null,
  ) => {
    // A bill line may hold no quantity (cost only). JobTread prices a line at
    // quantity × unit, so a 0 here would land the line at $0: send 1 instead.
    const q = quantity || 1;
    return {
      _type: "costItem",
      name: name.slice(0, 250),
      ...(description ? { description } : {}),
      jobCostItemId,
      ...(leaf.costCodeId ? { costCodeId: leaf.costCodeId } : {}),
      ...(leaf.costTypeId ? { costTypeId: leaf.costTypeId } : {}),
      ...(leaf.unitId ? { unitId: leaf.unitId } : {}),
      quantity: q,
      unitCost: cost / q,
      // JobTread keeps the unitPrice sent; price = quantity × unitPrice lands on
      // the cent worked out here.
      unitPrice: price / q,
      isTaxable,
    };
  };

  let price = 0;
  const unleafed: string[] = [];

  // Bills: one group per bill under each code its lines carry.
  for (const b of bills) {
    for (const l of src.billLines.filter((x) => x.billId === b.id)) {
      if (!l.jobCostItemId) {
        unleafed.push(`${b.vendor} ${b.label}: "${l.name}"`);
        continue;
      }
      const p = r2(l.cost * markup);
      price += p;
      groupFor(l.code, l.codeName, b.id, `${b.vendor} Bill ${b.label}`, `${jobName} - ${b.vendor}`).lineItems.push(
        costItem(l.name, l, l.jobCostItemId, l.quantity, l.cost, p, l.isTaxable, l.description),
      );
    }
  }

  // Time: one line per day per budget leaf, the unit the preview's fee is
  // rounded on, under a "Time Cost for <day>" group in the leaf's code.
  const byDayLeaf = new Map<string, { day: string; leafId: string; hours: number; cost: number }>();
  for (const t of entries) {
    if (!t.costItemId || !src.leaves[t.costItemId]) {
      unleafed.push(`${t.employee}'s time on ${t.startedAt ? dayOf(t.startedAt) : "an unknown day"}`);
      continue;
    }
    const day = dayOf(t.startedAt ?? "");
    const k = `${day}|${t.costItemId}`;
    const g = byDayLeaf.get(k) ?? { day, leafId: t.costItemId, hours: 0, cost: 0 };
    g.hours += t.hours;
    g.cost += t.cost;
    byDayLeaf.set(k, g);
  }
  if (unleafed.length) {
    throw new Error(`These have no budget item to attach to. Code them first: ${unleafed.join("; ")}.`);
  }
  const days = Array.from(byDayLeaf.values()).sort((a, b) => b.day.localeCompare(a.day));
  for (const g of days) {
    const leaf = src.leaves[g.leafId];
    const p = r2(g.cost * markup);
    price += p;
    const hours = Math.round(g.hours * 100) / 100;
    groupFor(leaf.code, leaf.codeName, `time|${g.day}`, `Time Cost for ${dayLabel(g.day)}`).lineItems.push(
      costItem(leaf.name, leaf, leaf.id, hours, r2(g.cost), p, true),
    );
  }
  price = r2(price);

  const expected = r2(u.total + (u.invoice?.fee ?? 0));
  if (Math.abs(price - expected) > 0.005) {
    throw new Error(`The draft would total ${price.toFixed(2)} but the preview shows ${expected.toFixed(2)}. Nothing was created.`);
  }

  const group = (name: string, lineItems: any[], description?: string) => ({
    _type: "costGroup",
    name: name.slice(0, 250),
    ...(description ? { description } : {}),
    lineItems,
  });
  const byName = <T,>(m: Map<string, T>) => Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  const lineItems = byName(tree).flatMap(([divLabel, codes]) => {
    const children = byName(codes).flatMap(([codeLabel, groups]) => {
      const gs = Array.from(groups.values()).map((g) => group(g.name, g.lineItems, g.description));
      return codeLabel ? [group(codeLabel, gs)] : gs;
    });
    return divLabel ? [group(divLabel, children)] : children;
  });

  const billIds = bills.map((b) => b.id);
  const timeEntryIds = entries.map((t) => t.id);
  if (billIds.length + timeEntryIds.length > 1000) {
    throw new Error("More than 1000 bills and time entries: JobTread takes at most 1000 references on one invoice.");
  }

  return {
    input: {
      type: "customerInvoice",
      jobId: src.jobId,
      name: INVOICE_DRAFT_NAME,
      fromName: header.fromName,
      ...(header.fromAddress ? { fromAddress: header.fromAddress } : {}),
      toName: header.toName,
      ...(header.toAddress ? { toAddress: header.toAddress } : {}),
      jobLocationName: header.jobLocationName,
      jobLocationAddress: header.jobLocationAddress,
      issueDate: billingMonthEnd({ billingYear: src.year, billingMonthNum: src.month }),
      dueDays: INVOICE_DRAFT_DUE_DAYS,
      taxRate: header.taxRate,
      references: [
        ...billIds.map((id) => ({ _type: "document", id })),
        ...timeEntryIds.map((id) => ({ _type: "timeEntry", id })),
      ],
      lineItems,
    },
    billIds,
    timeEntryIds,
    price,
  };
}

type RefNode = { id: string; type: string; status: string };

/** The customer invoices each bill and time entry is on, by id. */
async function readInvoiceRefs(
  cfg: PaveConfig,
  jobId: string,
  billIds: string[],
  timeEntryIds: string[],
): Promise<Map<string, RefNode[]>> {
  const refs = { referencedDocuments: { nodes: { id: {}, type: {}, status: {} } } };
  const read = (conn: "documents" | "timeEntries", ids: string[], size: number) =>
    ids.length
      ? pageAll<any>(cfg, {
          label: `job.${conn} (invoice references)`,
          size,
          query: (args) => ({
            job: { $: { id: jobId }, [conn]: { $: { where: ["id", "in", ids], ...args }, nextPage: {}, nodes: { id: {}, ...refs } } },
          }),
          pick: (r) => r?.job?.[conn],
        })
      : Promise.resolve([]);
  // referencedDocuments nested in a paged connection 413s above 50 (invoiceStaging.ts).
  const rows = [...(await read("documents", billIds, 25)), ...(await read("timeEntries", timeEntryIds, 50))];
  return new Map(
    rows.map((n) => [n.id, ((n.referencedDocuments?.nodes ?? []) as RefNode[]).filter((d) => d.type === "customerInvoice")]),
  );
}

/**
 * Every read the draft needs, then the pure build, then the double-create
 * guard. Writes nothing.
 */
export async function prepareInvoiceDraft(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<InvoiceDraftPlan> {
  const uninvoiced = await getUninvoicedBills(cfg, jobId, year, month);
  const billIds = uninvoiced.lines.flatMap((l) => (l.bills ?? []).map((b) => b.id));
  const leafIds = Array.from(
    new Set((uninvoiced.lines.find((l) => l.key === "time")?.timeEntries ?? []).flatMap((t) => (t.costItemId ? [t.costItemId] : []))),
  );
  const lineNodes = { id: {}, name: {}, description: {}, quantity: {}, unitCost: {}, cost: {}, isTaxable: {}, costCode: { id: {}, number: {}, name: {} }, costType: { id: {} }, unit: { id: {} } };
  const linesOf = (where: unknown, extra: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: "job.costItems (draft invoice lines)",
      query: (args) => ({ job: { $: { id: jobId }, costItems: { $: { where, ...args }, nextPage: {}, nodes: { ...lineNodes, ...extra } } } }),
      pick: (r) => r?.job?.costItems,
    });
  const [rawLines, rawLeaves, head] = await Promise.all([
    billIds.length ? linesOf([["document", "id"], "in", billIds], { jobCostItem: { id: {} }, document: { id: {} } }) : [],
    leafIds.length ? linesOf(["id", "in", leafIds], {}) : [],
    pave(cfg, {
      organization: { $: { id: cfg.orgId }, name: {}, address: {} },
      job: {
        $: { id: jobId },
        priceType: {},
        location: { name: {}, address: {}, taxRate: {}, customTaxRate: {}, account: { primaryContact: { name: {} } } },
      },
    }),
  ]);
  const ref = (n: any) => ({
    costCodeId: n.costCode?.id ?? null,
    code: String(n.costCode?.number ?? "").trim(),
    codeName: String(n.costCode?.name ?? ""),
    costTypeId: n.costType?.id ?? null,
    unitId: n.unit?.id ?? null,
  });

  const job = head?.job;
  if (!["costPlus", "fixed"].includes(job?.priceType)) {
    throw new Error("JobTread only takes an invoice on a cost-plus or fixed-price job. Set this job's price type first.");
  }
  const loc = job?.location;
  if (!loc?.name || !loc?.address) throw new Error("This job has no location address, which JobTread needs on an invoice.");

  const plan = buildInvoiceDraft({
    jobId,
    year,
    month,
    uninvoiced,
    billLines: rawLines.map((n) => ({
      billId: n.document?.id,
      name: String(n.name ?? ""),
      description: n.description ?? null,
      quantity: Number(n.quantity) || 0,
      unitCost: Number(n.unitCost) || 0,
      cost: Number(n.cost) || 0,
      isTaxable: n.isTaxable !== false, // Create Invoice copies the bill line's flag
      jobCostItemId: n.jobCostItem?.id ?? null,
      ...ref(n),
    })),
    leaves: Object.fromEntries(rawLeaves.map((n) => [n.id, { id: n.id, name: String(n.name ?? ""), ...ref(n) }])),
    header: {
      fromName: head?.organization?.name || "Ascent Building Co.",
      fromAddress: head?.organization?.address ?? null,
      toName: loc.account?.primaryContact?.name || uninvoiced.customer?.name || "Customer",
      toAddress: loc.address,
      jobLocationName: loc.name,
      jobLocationAddress: loc.address,
      taxRate: loc.customTaxRate ?? loc.taxRate ?? 0,
    },
  });

  // A bill already on a draft would be billed twice once both drafts go out.
  const onDraft = await readInvoiceRefs(cfg, jobId, plan.billIds, plan.timeEntryIds);
  const drafts = new Set(Array.from(onDraft.values()).flatMap((ns) => ns.filter((n) => n.status === "draft").map((n) => n.id)));
  if (drafts.size) {
    throw new Error(
      `This job already has a draft invoice holding some of these bills or time entries (${Array.from(drafts).join(", ")}). ` +
        "Open it in JobTread, or void it, before creating another.",
    );
  }
  return plan;
}

/**
 * WRITE — create the draft, then re-read every bill and time entry it
 * references. JobTread drops a reference it will not take without an error, and
 * a cost whose reference did not set would be billed again next month, so a
 * draft missing any is voided (pending, then denied — never deleted).
 */
export async function sendInvoiceDraft(
  cfg: PaveConfig,
  jobId: string,
  plan: InvoiceDraftPlan,
): Promise<{ id: string; url: string; price: number }> {
  const r = await pave(cfg, { createDocument: { $: plan.input, createdDocument: { id: {} } } });
  const id: string | undefined = r?.createDocument?.createdDocument?.id;
  if (!id) throw new Error("JobTread created no invoice.");
  const url = `https://app.jobtread.com/jobs/${jobId}/documents/${id}`;

  const after = await readInvoiceRefs(cfg, jobId, plan.billIds, plan.timeEntryIds);
  const missing = [...plan.billIds, ...plan.timeEntryIds].filter((x) => !(after.get(x) ?? []).some((n) => n.id === id));
  if (missing.length) {
    try {
      for (const status of ["pending", "denied"]) {
        await pave(cfg, { updateDocument: { $: { id, status }, document: { $: { id }, id: {} } } });
      }
    } catch (e) {
      throw new Error(
        `The draft invoice did not take ${missing.length} reference(s) (${missing.join(", ")}), and voiding it failed: ` +
          `${e instanceof Error ? e.message : e}. Void it by hand: ${url}`,
      );
    }
    throw new Error(
      `The draft invoice did not take ${missing.length} reference(s) (${missing.join(", ")}), so it was voided. Create it in JobTread instead.`,
    );
  }
  return { id, url, price: plan.price };
}
