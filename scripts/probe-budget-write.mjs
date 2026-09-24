// Probe: can the Assistant edit a job's BUDGET directly (Budget Import's
// "Import into JT")? Answers four questions against the live API:
//   1. createCostGroup on a job, and nested under another group
//   2. createCostItem in a group and at the job's top level, with NO price —
//      what price does JobTread give it?
//   3. updateCostItem changing cost, quantity, cost type, unit — does the price
//      follow the cost (margin kept) or stay where it was?
//   4. updateCostItem moving an item into a group (costGroupId)
//
// Writes only "ZZ probe" rows on the internal Office job (007) and zeroes the
// items at the end, as the owner asked (2026-09-24). The connector's grant
// cannot run these — a budget write needs the "updateJob" grant action — so
// this uses the app's key from .env.local.
// Run: node scripts/probe-budget-write.mjs
import fs from "node:fs";

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
const JOB = "22PXevQbM9FQ"; // 007 Office (Ascent / The Shop)
const LABOR = "22PXG7Zt8iGY", MATERIALS = "22PXG7Zt9qxR", ALLOWANCE_TYPE = "22PdHWuXqAaX";
const MONTHS = "22PXiH8gVcyH", HOURS = "22PXG7Zs9VMc", ALLOWANCE_UNIT = "22PXG7ZsAywn";
const CODE_PRINCIPAL = "22PXGEyy4Q7y", CODE_CONSUMABLES = "22PXGEz4rPUw";

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

const itemSel = {
  id: {}, name: {}, quantity: {}, unitCost: {}, cost: {}, unitPrice: {}, price: {},
  costType: { name: {} }, unit: { name: {} }, costCode: { number: {} },
  costGroup: { id: {}, name: {} }, job: { id: {} }, document: { id: {} },
};
const readItem = async (id) => (await pave({ costItem: { $: { id }, ...itemSel } })).costItem;
const update = (id, fields) => pave({ updateCostItem: { $: { id, ...fields }, costItem: { $: { id }, id: {} } } });
const show = (label, v) => console.log(label.padEnd(34), JSON.stringify(v));

const g = (await pave({ createCostGroup: { $: { jobId: JOB, name: "ZZ probe - Budget Import (2026-09-24)" },
  createdCostGroup: { id: {}, name: {}, job: { id: {} } } } })).createCostGroup.createdCostGroup;
show("1a group on job", g);
const s = (await pave({ createCostGroup: { $: { parentCostGroupId: g.id, name: "ZZ probe - nested group" },
  createdCostGroup: { id: {}, job: { id: {} }, parentCostGroup: { id: {} } } } })).createCostGroup.createdCostGroup;
show("1b nested group", s);

const a = (await pave({ createCostItem: { $: { costGroupId: s.id, name: "ZZ probe - in group, no price",
  costCodeId: CODE_PRINCIPAL, costTypeId: LABOR, unitId: MONTHS, quantity: 12, unitCost: 100 },
  createdCostItem: { id: {} } } })).createCostItem.createdCostItem;
show("2a item in group, no price", await readItem(a.id));
const b = (await pave({ createCostItem: { $: { jobId: JOB, name: "ZZ probe - top level, no qty",
  costCodeId: CODE_CONSUMABLES, costTypeId: ALLOWANCE_TYPE, unitId: ALLOWANCE_UNIT, unitCost: 50 },
  createdCostItem: { id: {} } } })).createCostItem.createdCostItem;
show("2b item at top level, no qty", await readItem(b.id));

await update(a.id, { unitCost: 200, quantity: 6, costTypeId: MATERIALS, unitId: HOURS, description: "probe" });
show("3  after cost/qty/type/unit update", await readItem(a.id));

await update(b.id, { costGroupId: g.id });
show("4  after move into group", await readItem(b.id));

await update(a.id, { unitCost: 0, quantity: null });
await update(b.id, { unitCost: 0 });
show("   zeroed a", await readItem(a.id));
show("   zeroed b", await readItem(b.id));
