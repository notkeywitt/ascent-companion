// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.
//
// The Bill Clones page (/bill-clone): a vendor's month of documents, and the
// write that copies one of them. Rules live in src/lib/billClone.ts.

import { cloneExternalId, type CloneDoc } from "@/lib/billClone";
import { pageAll, pave, type PaveConfig } from "./core";

/** Every vendorBill document of one vendor issued in [first, last], voids included. */
export async function getVendorMonthDocs(
  cfg: PaveConfig,
  accountId: string,
  first: string,
  last: string,
): Promise<CloneDoc[]> {
  const rows = await pageAll<any>(cfg, {
    label: "organization.documents (bill clones)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        documents: {
          $: {
            where: {
              and: [
                ["type", "vendorBill"],
                [["account", "id"], accountId],
                ["issueDate", ">=", first],
                ["issueDate", "<=", last],
              ],
            },
            ...args,
          },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            status: {},
            number: {},
            externalId: {},
            issueDate: {},
            cost: {},
            qboDocumentType: {},
            qboId: {},
            job: { id: {}, name: {} },
          },
        },
      },
    }),
    pick: (a) => a?.organization?.documents,
  });
  return rows.map((d) => ({
    id: d.id,
    jobId: d.job?.id ?? "",
    jobName: d.job?.name ?? "",
    number: d.number == null ? "" : String(d.number),
    externalId: d.externalId ?? "",
    issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : "",
    cost: typeof d.cost === "number" ? d.cost : 0,
    name: d.name ?? "",
    status: d.status ?? "",
    qboDocumentType: d.qboDocumentType ?? "",
    qboId: d.qboId ? String(d.qboId) : "",
  }));
}

const LINE_LIMIT = 100;

/**
 * WRITE — create a draft copy of a vendor document. Every field createDocument
 * accepts is copied as it stands: vendor, job, name, Push as and its account,
 * subject, dates, terms, tax fields, location, QuickBooks flags, and each line
 * with its exact quantity, unit cost, codes, coding target and custom fields.
 * Files are copied by JobTread itself (copyFromFileId). The externalId is the
 * original's plus "-B". JobTread numbers the new document itself.
 *
 * Refuses a document with 100 or more lines: the read does not page, and a
 * short copy is worse than none.
 */
export async function cloneVendorDocument(
  cfg: PaveConfig,
  docId: string,
): Promise<{ id: string; externalId: string; cost: number }> {
  const r = await pave<any>(cfg, {
    document: {
      $: { id: docId },
      id: {},
      type: {},
      name: {},
      externalId: {},
      subject: {},
      description: {},
      fromName: {},
      toName: {},
      issueDate: {},
      dueDate: {},
      dueDays: {},
      jobLocationName: {},
      jobLocationAddress: {},
      taxRate: {},
      nonRecoverableTax: {},
      nonRecoverableTaxName: {},
      includeInBudget: {},
      qboDocumentType: {},
      qboAccountId: {},
      qboClassId: {},
      qboIsBillable: {},
      qboIsIgnored: {},
      cost: {},
      account: { id: {} },
      job: { id: {} },
      costItems: {
        $: { size: LINE_LIMIT },
        nodes: {
          id: {},
          name: {},
          description: {},
          quantity: {},
          unitCost: {},
          isTaxable: {},
          costCode: { id: {} },
          costType: { id: {} },
          unit: { id: {} },
          jobCostItem: { id: {} },
          customFieldValues: { $: { size: 25 }, nodes: { value: {}, customField: { id: {} } } },
        },
      },
      files: { $: { size: 100 }, nodes: { id: {}, name: {} } },
    },
  });
  const d = r?.document;
  if (!d?.id) throw new Error("could not read the original");
  if (d.type !== "vendorBill") throw new Error("not a vendor bill");
  const lines: any[] = d.costItems?.nodes ?? [];
  if (lines.length >= LINE_LIMIT) throw new Error(`${lines.length}+ lines — copy it by hand`);

  const lineItems = lines.map((l) => {
    const li: Record<string, unknown> = {
      _type: "costItem",
      name: l.name ?? "",
      description: l.description ?? "",
      quantity: l.quantity ?? 0,
      unitCost: l.unitCost ?? 0,
      isTaxable: !!l.isTaxable,
    };
    if (l.costCode?.id) li.costCodeId = l.costCode.id;
    if (l.costType?.id) li.costTypeId = l.costType.id;
    if (l.unit?.id) li.unitId = l.unit.id;
    if (l.jobCostItem?.id) li.jobCostItemId = l.jobCostItem.id;
    // The array form, as createVendorBill sends it (proven live).
    const cfv = (l.customFieldValues?.nodes ?? [])
      .filter((v: any) => v.customField?.id && v.value != null && v.value !== "")
      .map((v: any) => ({ customFieldId: v.customField.id, value: v.value }));
    if (cfv.length) li.customFieldValues = cfv;
    return li;
  });

  const externalId = cloneExternalId({ id: d.id, externalId: d.externalId });
  const $: Record<string, unknown> = {
    type: "vendorBill",
    jobId: d.job?.id,
    accountId: d.account?.id,
    name: d.name || "Bill",
    fromName: d.fromName || "",
    toName: d.toName || "",
    externalId,
    issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : undefined,
    taxRate: d.taxRate ?? 0,
    nonRecoverableTax: d.nonRecoverableTax ?? 0,
    includeInBudget: d.includeInBudget ?? true,
    qboIsBillable: d.qboIsBillable ?? true,
    qboIsIgnored: !!d.qboIsIgnored,
    lineItems,
  };
  if (d.subject) $.subject = d.subject;
  if (d.description) $.description = d.description;
  if (d.nonRecoverableTaxName) $.nonRecoverableTaxName = d.nonRecoverableTaxName;
  if (d.jobLocationName) $.jobLocationName = d.jobLocationName;
  if (d.jobLocationAddress) $.jobLocationAddress = d.jobLocationAddress;
  if (d.qboDocumentType) $.qboDocumentType = d.qboDocumentType;
  if (d.qboAccountId) $.qboAccountId = d.qboAccountId;
  if (d.qboClassId) $.qboClassId = d.qboClassId;
  if (d.dueDate) $.dueDate = String(d.dueDate).slice(0, 10);
  else if (d.dueDays != null) $.dueDays = d.dueDays;
  const files = (d.files?.nodes ?? []).map((f: any) => ({ copyFromFileId: f.id, name: f.name }));
  if (files.length) $.files = files;

  const c = await pave<any>(cfg, {
    createDocument: { $, createdDocument: { id: {}, cost: {}, externalId: {} } },
  });
  const created = c?.createDocument?.createdDocument;
  if (!created?.id) throw new Error("createDocument returned no document id");
  return { id: created.id, externalId, cost: Number(created.cost) || 0 };
}
