// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { type DrawInvoice, DEPOSIT_CSI } from "@/lib/deposits";
import { clearJobCostCaches, pageAll, pave, type PaveConfig } from "./core";
import { resolveCostCodeId } from "./sunsetStatements";
import { pEq } from "./jobDeposits";
// ---------------------------------------------------------------------------
// DEPOSIT DRAWS  (WRITE). A draw is ONE line on a
// DRAFT customer invoice: name "Deposit", linked to the job's CD budget leaf,
// unitPrice and unitCost −X, not taxable — the shape of Berger #320 and Ferron
// #386. The rules that allow it are planDepositDraw (src/lib/deposits.ts); the
// route is /api/deposits/apply. Never createLine: it forces the document's
// taxRate to 0, which would erase the invoice's sales tax.
// UNVERIFIED until scripts/probe-deposit-line.mjs runs live: whether JobTread
// takes the line at face value on an invoice with a tax rate.
// ---------------------------------------------------------------------------

/** The invoice a draw lands on, as JobTread holds it now. */
export interface DepositDrawTarget extends DrawInvoice {
  jobId: string;
  name: string;
  price: number;
  tax: number;
}

export async function getInvoiceForDraw(cfg: PaveConfig, invoiceId: string): Promise<DepositDrawTarget> {
  const r = await pave(cfg, {
    document: {
      $: { id: invoiceId },
      id: {},
      type: {},
      number: {},
      name: {},
      status: {},
      price: {},
      tax: {},
      priceWithTax: {},
      qboId: {},
      job: { id: {} },
      costItems: {
        $: { size: 100, where: pEq(["costCode", "number"], DEPOSIT_CSI) },
        nodes: { id: {}, price: {} },
      },
    },
  });
  const d = r?.document;
  if (!d?.id) throw new Error("That invoice does not exist in JobTread.");
  if (d.type !== "customerInvoice") throw new Error("That document is not a customer invoice.");
  return {
    id: String(d.id),
    number: typeof d.number === "number" ? d.number : null,
    name: String(d.name ?? ""),
    status: String(d.status ?? ""),
    price: Number(d.price) || 0,
    tax: Number(d.tax) || 0,
    priceWithTax: Number(d.priceWithTax) || 0,
    inQbo: d.qboId != null,
    jobId: String(d?.job?.id ?? ""),
    depositLines: (d?.costItems?.nodes ?? []).map((n: any) => ({ id: String(n.id), price: Number(n.price) || 0 })),
  };
}

/**
 * The job's CD budget leaf a new draw links to: the one the job's last draw
 * used (Ferron's draws link to its $0 "Deposit" leaf, not the $123,000 one, and
 * the next should match); else the largest CD leaf; else a new $0 "Deposit"
 * leaf, the way resolveShopBuybackLeaf adds a missing one.
 */
export async function resolveDepositLeaf(cfg: PaveConfig, jobId: string): Promise<string> {
  const items = await pageAll<any>(cfg, {
    label: "job.costItems (CD leaves)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        costItems: {
          $: { ...args, where: pEq(["costCode", "number"], DEPOSIT_CSI) },
          nextPage: {},
          nodes: { id: {}, price: {}, createdAt: {}, document: { id: {} }, jobCostItem: { id: {} } },
        },
      },
    }),
    pick: (a) => a?.job?.costItems,
  });
  const leaves = items.filter((i) => !i?.document);
  const leafIds = new Set(leaves.map((l) => String(l.id)));
  const lastUsed = items
    .filter((i) => i?.document && (Number(i.price) || 0) < 0 && leafIds.has(String(i?.jobCostItem?.id)))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0];
  if (lastUsed) return String(lastUsed.jobCostItem.id);
  if (leaves.length) {
    return String([...leaves].sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0))[0].id);
  }
  const costCodeId = await resolveCostCodeId(cfg, DEPOSIT_CSI);
  if (!costCodeId) throw new Error(`No "${DEPOSIT_CSI}" cost code in JobTread.`);
  const created = await pave(cfg, {
    createCostItem: {
      $: { jobId, costCodeId, name: "Deposit", quantity: 0, unitCost: 0, isTaxable: false },
      createdCostItem: { id: {} },
    },
  });
  const id = created?.createCostItem?.createdCostItem?.id;
  if (!id) throw new Error("Could not add the job's Deposit budget leaf.");
  clearJobCostCaches(); // the job's budget just gained a leaf
  return String(id);
}

export interface DepositDrawResult {
  lineId: string | null;
  before: { price: number; tax: number; priceWithTax: number };
  after: { price: number; tax: number; priceWithTax: number };
}

/**
 * Write a planned draw: add, change or remove the invoice's one deposit line.
 * Re-reads the invoice and checks the price moved by exactly the draw and the
 * tax did not move. On a mismatch it puts the line back the way it was and
 * throws — the write is either right or undone.
 */
export async function writeDepositDraw(
  cfg: PaveConfig,
  inv: DepositDrawTarget,
  plan: { mode: "create" | "update" | "delete"; lineId: string | null; from: number; to: number },
  leafId: string | null,
): Promise<DepositDrawResult> {
  const before = { price: inv.price, tax: inv.tax, priceWithTax: inv.priceWithTax };
  const line = (x: number) => ({ quantity: 1, unitPrice: -x, unitCost: -x, isTaxable: false });
  let lineId = plan.lineId;

  if (plan.mode === "create") {
    if (!leafId) throw new Error("No Deposit budget leaf to link the line to.");
    const r = await pave(cfg, {
      createCostItem: {
        $: { documentId: inv.id, jobCostItemId: leafId, name: "Deposit", ...line(plan.to) },
        createdCostItem: { id: {} },
      },
    });
    lineId = r?.createCostItem?.createdCostItem?.id ? String(r.createCostItem.createdCostItem.id) : null;
    if (!lineId) throw new Error("JobTread did not return the new deposit line.");
  } else if (plan.mode === "update") {
    if (!lineId) throw new Error("No deposit line to change.");
    await pave(cfg, { updateCostItem: { $: { id: lineId, ...line(plan.to) }, costItem: { $: { id: lineId }, id: {} } } });
  } else {
    if (!lineId) throw new Error("No deposit line to remove.");
    await pave(cfg, { deleteCostItem: { $: { id: lineId } } });
    lineId = null;
  }

  const a = (await pave(cfg, { document: { $: { id: inv.id }, price: {}, tax: {}, priceWithTax: {} } }))?.document;
  const after = {
    price: Number(a?.price) || 0,
    tax: Number(a?.tax) || 0,
    priceWithTax: Number(a?.priceWithTax) || 0,
  };
  const priceDrop = Math.round((before.price - after.price) * 100) / 100;
  const want = Math.round((plan.to - plan.from) * 100) / 100;
  if (Math.abs(priceDrop - want) > 0.01 || Math.abs(after.tax - before.tax) > 0.01) {
    try {
      if (plan.mode === "create" && lineId) {
        await pave(cfg, { deleteCostItem: { $: { id: lineId } } });
      } else if (plan.mode === "update" && plan.lineId) {
        await pave(cfg, {
          updateCostItem: { $: { id: plan.lineId, ...line(plan.from) }, costItem: { $: { id: plan.lineId }, id: {} } },
        });
      }
    } catch {
      /* reported below either way */
    }
    throw new Error(
      `JobTread's totals did not move as planned (price ${before.price} → ${after.price}, ` +
        `tax ${before.tax} → ${after.tax}). The change was undone where it could be; check #${inv.number ?? inv.id} in JobTread.`,
    );
  }
  return { lineId, before, after };
}
