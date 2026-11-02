import {
  attachFileToDocument,
  createLine,
  createVendorBill,
  deleteLine,
  getJobHeaderInfo,
  isExpenseDoc,
  pave,
  type PaveConfig,
} from "@/lib/jobtread";

/**
 * SPLIT A DRAFT BILL IN TWO (owner, 2026-11-02): the lines the office picks move
 * to a new draft bill on the same job, with the same vendor, dates and terms,
 * and a copy of the original's PDF.
 *
 * Built only from writes this app already makes — createVendorBill, createLine,
 * deleteLine and attachFileToDocument — in the order buybackLine uses: every
 * line lands on the new bill BEFORE any line comes off the original, so a
 * failure part-way shows a cost twice (easy to see) rather than losing it.
 *
 * The new bill's invoice number is the original's with "-2" (then "-3", …):
 * both stay findable by the paper invoice's number, and the Apps Script mirror,
 * which matches bills to sheet rows by externalId, sees a new bill rather than
 * a duplicate of the original.
 *
 * Draft only: JobTread locks a bill's amounts once it leaves draft. The caller
 * also runs qboLock and the writes switch.
 */

export interface SplitLine {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unitCost: number;
  cost: number;
  jobCostItemId: string;
  costCode: string;
}

export interface SplitResult {
  newDocId: string;
  externalId: string;
  moved: SplitLine[];
  /** Files copied to the new bill, and any that could not be. */
  filesCopied: number;
  fileErrors: string[];
}

/** The next free "<ext>-N" on this job, from 2. */
async function nextExternalId(cfg: PaveConfig, jobId: string, ext: string): Promise<string> {
  const base = (ext || "SPLIT").slice(0, 28);
  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      documents: {
        $: { where: ["externalId", "like", `${base}-%`], size: 100 },
        nodes: { externalId: {} },
      },
    },
  });
  const taken = new Set<string>(
    (r?.job?.documents?.nodes ?? []).map((d: { externalId?: string }) => String(d.externalId ?? "")),
  );
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  throw new Error("This bill has been split too many times.");
}

export async function splitBill(cfg: PaveConfig, docId: string, lineIds: string[]): Promise<SplitResult> {
  const r = await pave(cfg, {
    document: {
      $: { id: docId },
      id: {},
      type: {},
      status: {},
      name: {},
      subject: {},
      fromName: {},
      externalId: {},
      issueDate: {},
      dueDate: {},
      dueDays: {},
      qboIsIgnored: {},
      qboDocumentType: {},
      account: { id: {} },
      job: { id: {} },
      costItems: {
        $: { size: 100 },
        nodes: {
          id: {},
          name: {},
          description: {},
          quantity: {},
          unitCost: {},
          cost: {},
          costCode: { number: {} },
          jobCostItem: { id: {} },
        },
      },
      files: { nodes: { id: {}, name: {}, type: {}, url: {} } },
    },
  });
  const d = r?.document;
  if (!d?.id) throw new Error("Bill not found.");
  if (d.type !== "vendorBill") throw new Error("Only a vendor bill can be split.");
  if (d.status !== "draft") throw new Error("Only a draft bill can be split — JobTread locks a bill once it leaves draft.");
  const accountId = d.account?.id;
  const jobId = d.job?.id;
  if (!accountId || !jobId) throw new Error("This bill has no vendor or job, so it cannot be split.");

  const all: SplitLine[] = (d.costItems?.nodes ?? []).map((n: any) => ({
    id: String(n.id),
    name: String(n.name ?? ""),
    description: String(n.description ?? ""),
    quantity: typeof n.quantity === "number" ? n.quantity : 1,
    unitCost: typeof n.unitCost === "number" ? n.unitCost : 0,
    cost: typeof n.cost === "number" ? n.cost : 0,
    jobCostItemId: String(n.jobCostItem?.id ?? ""),
    costCode: String(n.costCode?.number ?? "").trim(),
  }));
  const pick = new Set(lineIds);
  const moved = all.filter((l) => pick.has(l.id));
  if (moved.length === 0) throw new Error("Pick at least one line to move.");
  if (moved.length !== pick.size) throw new Error("A picked line is not on this bill any more. Reload and try again.");
  if (moved.length === all.length) throw new Error("Leave at least one line on the original bill.");

  const [externalId, head] = await Promise.all([
    nextExternalId(cfg, jobId, String(d.externalId ?? "").trim()),
    getJobHeaderInfo(cfg, jobId),
  ]);

  const { id: newDocId } = await createVendorBill(cfg, {
    jobId,
    accountId,
    vendorName: d.fromName || "Vendor",
    subject: d.subject || d.fromName || "Vendor bill",
    externalId,
    issueDate: d.issueDate || new Date().toISOString().slice(0, 10),
    dueDate: d.dueDate || null,
    dueDays: typeof d.dueDays === "number" ? d.dueDays : null,
    taxAmount: 0,
    jobLocationName: head.name || undefined,
    jobLocationAddress: head.address || undefined,
    pushToQuickBooks: !d.qboIsIgnored,
    billType: isExpenseDoc(d) ? "Expense" : "Bill",
    lines: [],
  });

  // Every line onto the new bill first…
  for (const l of moved) {
    await createLine(cfg, newDocId, {
      name: l.name,
      quantity: l.quantity,
      unitCost: l.unitCost,
      description: l.description,
      jobCostItemId: l.jobCostItemId || undefined,
      costCode: l.costCode || undefined,
    });
  }
  // …then off the original.
  for (const l of moved) await deleteLine(cfg, l.id);

  // The invoice PDF on both, so each bill keeps its backup. Best-effort: a file
  // that will not copy leaves the split done and says so.
  let filesCopied = 0;
  const fileErrors: string[] = [];
  for (const f of d.files?.nodes ?? []) {
    if (!f?.url) continue;
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      await attachFileToDocument(cfg, newDocId, bytes, f.type || res.headers.get("content-type") || "application/pdf", f.name || "invoice.pdf");
      filesCopied++;
    } catch (e) {
      fileErrors.push(`${f.name || "file"}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { newDocId, externalId, moved, filesCopied, fileErrors };
}
