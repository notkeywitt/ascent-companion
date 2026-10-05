// Probe: can the Assistant draw a deposit with a CD line on a customer invoice?
// DEPOSITS_PLAN.md, Stage 4. Answers the plan's five questions against the
// live API before any route writes a deposit line:
//   1. createCostItem on a customer invoice — is jobCostItemId required (it is
//      for a vendor bill)?
//   2. A negative unitPrice with isTaxable false, on an invoice whose taxRate
//      is above 0 — does the price drop by exactly X and the tax stay put?
//   3. unitCost −X — does the document's cost drop by X?
//   4. Does a draft invoice stay out of QuickBooks (no qboId) throughout?
//   5. updateCostItem changes the amount; deleteCostItem removes the line —
//      do the totals follow both?
//
// Writes only on the internal Office job (007): one "ZZ probe" customer invoice
// (VOIDED at the end — status denied, never deleted; see CLAUDE.md) and, if the
// job has none, one $0 CD budget leaf plus one $0 work leaf. The owner must
// approve a live run first (DEPOSITS_PLAN.md §6).
//
// Uses the app's key from .env.local, like probe-budget-write.mjs.
// Dry by default — prints the plan and exits:
//   node scripts/probe-deposit-line.mjs
// Live:
//   node scripts/probe-deposit-line.mjs --live
import fs from "node:fs";

const LIVE = process.argv.includes("--live");
const JOB = "22PXevQbM9FQ"; // 007 Office (Ascent / The Shop)
const CODE_CD = "22PbMZGxCvxN"; // CD Contract Deposit
const CODE_CONSUMABLES = "22PXGEz4rPUw"; // 01 31 30 Consumables
const TAX_RATE = 0.085;
const X = 500; // the probe draw

const show = (label, v) => console.log(String(label).padEnd(40), JSON.stringify(v));

if (!LIVE) {
  console.log("DRY RUN — nothing is written. Add --live to run it (owner's ok first).\n");
  [
    "read the Office job's CD and 01 31 30 budget leaves (create $0 ones if missing)",
    `createDocument customerInvoice "ZZ probe — deposit line" (draft, taxRate ${TAX_RATE}), one taxable work line $1,000 cost / $1,180 price`,
    `createCostItem Deposit −$${X} on it WITHOUT jobCostItemId → question 1`,
    `createCostItem Deposit −$${X} WITH the CD leaf, if the first was refused`,
    "re-read the invoice: price, tax, priceWithTax, cost, qboId → questions 2, 3, 4",
    "updateCostItem the line to −$300, re-read → question 5a",
    "deleteCostItem the line, re-read → question 5b",
    "updateDocument status denied (the void) — the probe invoice is never deleted",
  ].forEach((s, i) => console.log(`${i + 1}. ${s}`));
  process.exit(0);
}

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const grantKey = env.JT_GRANT_KEY;
if (!grantKey) throw new Error("JT_GRANT_KEY is not in .env.local");

async function pave(query) {
  const res = await fetch("https://api.jobtread.com/pave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok || json?.errors) {
    throw new Error(`HTTP ${res.status}: ${json?.errors?.map((e) => e.message).join("; ") ?? text.slice(0, 300)}`);
  }
  return json;
}

const eq = (field, value) => ({ "=": [{ field }, { value }] });
const docSel = { id: {}, number: {}, status: {}, price: {}, tax: {}, taxRate: {}, priceWithTax: {}, cost: {}, qboId: {} };
const readDoc = async (id) => (await pave({ document: { $: { id }, ...docSel } })).document;
const readLine = async (id) =>
  (await pave({ costItem: { $: { id }, id: {}, price: {}, cost: {}, unitPrice: {}, unitCost: {}, isTaxable: {}, jobCostItem: { id: {} }, costCode: { number: {} } } })).costItem;

async function leafFor(codeId, codeNumber, name) {
  const r = await pave({
    job: {
      $: { id: JOB },
      costItems: {
        $: { size: 5, where: { and: [eq(["costCode", "number"], codeNumber), eq(["document", "id"], null)] } },
        nodes: { id: {}, name: {} },
      },
    },
  });
  const hit = r?.job?.costItems?.nodes?.[0];
  if (hit) return hit.id;
  const c = await pave({
    createCostItem: {
      $: { jobId: JOB, costCodeId: codeId, name, quantity: 0, unitCost: 0, isTaxable: false },
      createdCostItem: { id: {} },
    },
  });
  return c.createCostItem.createdCostItem.id;
}

const answers = {};
const cdLeaf = await leafFor(CODE_CD, "CD", "ZZ probe — Deposit");
const workLeaf = await leafFor(CODE_CONSUMABLES, "01 31 30", "ZZ probe — Consumables");
show("CD leaf / work leaf", { cdLeaf, workLeaf });

const created = await pave({
  createDocument: {
    $: {
      type: "customerInvoice",
      jobId: JOB,
      name: "ZZ probe — deposit line",
      fromName: "Ascent Building Co.",
      toName: "ZZ probe",
      // JobTread refuses a new invoice without a job location, and wants exactly
      // one of dueDate/dueDays (both learned 2026-10-05 through the connector).
      jobLocationName: "The Shop",
      jobLocationAddress: "4223 Center Rd, Lopez Island, WA 98261, USA",
      dueDays: 30,
      // Never reaches QuickBooks, whatever happens below.
      qboIsIgnored: true,
      taxRate: TAX_RATE,
      lineItems: [
        { _type: "costItem", name: "ZZ probe work", jobCostItemId: workLeaf, quantity: 1, unitCost: 1000, unitPrice: 1180, isTaxable: true },
      ],
    },
    createdDocument: docSel,
  },
});
const doc = created.createDocument.createdDocument;
show("invoice created", doc);

let lineId = null;
const lineFields = { documentId: doc.id, name: "Deposit", costCodeId: CODE_CD, quantity: 1, unitPrice: -X, unitCost: -X, isTaxable: false };
try {
  const r = await pave({ createCostItem: { $: lineFields, createdCostItem: { id: {} } } });
  lineId = r.createCostItem.createdCostItem.id;
  answers["1 jobCostItemId required"] = "no — accepted without it";
} catch (e) {
  answers["1 jobCostItemId required"] = `yes — ${e.message}`;
  // The second try sends exactly what writeDepositDraw sends: the leaf, no cost code.
  const { costCodeId: _omit, ...routeFields } = lineFields;
  const r = await pave({ createCostItem: { $: { ...routeFields, jobCostItemId: cdLeaf }, createdCostItem: { id: {} } } });
  lineId = r.createCostItem.createdCostItem.id;
}

const afterAdd = await readDoc(doc.id);
show("invoice after the draw", afterAdd);
show("draw line", await readLine(lineId));
const r2 = (n) => Math.round(n * 100) / 100;
answers["2 price drops by X, tax unchanged"] =
  r2(doc.price - afterAdd.price) === X && r2(afterAdd.tax) === r2(doc.tax)
    ? "yes"
    : `NO — price Δ ${r2(doc.price - afterAdd.price)}, tax ${doc.tax} → ${afterAdd.tax}`;
answers["3 cost drops by X"] = r2(doc.cost - afterAdd.cost) === X ? "yes" : `NO — cost Δ ${r2(doc.cost - afterAdd.cost)}`;

await pave({ updateCostItem: { $: { id: lineId, unitPrice: -300, unitCost: -300 }, costItem: { $: { id: lineId }, id: {} } } });
const afterUpdate = await readDoc(doc.id);
show("invoice after −$300", afterUpdate);
answers["5a update follows"] = r2(doc.price - afterUpdate.price) === 300 ? "yes" : `NO — price Δ ${r2(doc.price - afterUpdate.price)}`;

await pave({ deleteCostItem: { $: { id: lineId } } });
const afterDelete = await readDoc(doc.id);
show("invoice after delete", afterDelete);
answers["5b delete follows"] = r2(afterDelete.price) === r2(doc.price) ? "yes" : `NO — price ${afterDelete.price} vs ${doc.price}`;

answers["4 draft stays out of QuickBooks"] = [doc, afterAdd, afterUpdate, afterDelete].every((d) => !d.qboId)
  ? "yes — no qboId at any step"
  : "NO — a qboId appeared";

await pave({ updateDocument: { $: { id: doc.id, status: "denied" }, document: { $: { id: doc.id }, id: {} } } });
show("probe invoice voided", (await readDoc(doc.id)).status);

console.log("\nANSWERS");
for (const [q, a] of Object.entries(answers)) show(q, a);
