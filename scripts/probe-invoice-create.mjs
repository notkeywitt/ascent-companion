// Probe: can the Assistant create a draft customer invoice that JobTread treats
// like one its own builder made? `invoiceStaging.ts` says no: "a bare
// createDocument yields an EMPTY invoice and can't set that link". The schema
// now says otherwise (createDocument takes `lineItems` and `references`, and
// `references` accepts a document or a time entry). This asks the live API:
//   1. createDocument customerInvoice with `references` to a vendor bill — does
//      the bill's referencedDocuments gain the invoice (the "already invoiced"
//      flag every read in this repo uses)?
//   2. The same with a time entry.
//   3. Nested lineItems (division group → bill group → line) — do the groups
//      and the line come back, with the price we sent and not a re-marked-up one?
//   4. createDocumentReference on an existing invoice — does it set the flag too?
//   5. deleteDocumentReference — does it clear the flag (bill and time entry)?
//   6. Does the draft stay out of QuickBooks (no qboId) throughout?
//
// Writes only on the internal Office job (007):
//   - one "ZZ probe" draft customer invoice, VOIDED at the end (status denied,
//     never deleted; see CLAUDE.md);
//   - references from it to two bills that are ALREADY voided and to one Office
//     time entry. The probe removes every reference before it voids the invoice.
// It creates no bill and no time entry, so the hourly mirror has nothing new to
// copy. The connector's grant is read-only, so this uses the app's key from
// .env.local, like probe-deposit-line.mjs.
// Dry by default — prints the plan and exits:
//   node scripts/probe-invoice-create.mjs
// Live (owner's ok first):
//   node scripts/probe-invoice-create.mjs --live
import fs from "node:fs";

const LIVE = process.argv.includes("--live");
const JOB = "22PXevQbM9FQ"; // 007 Office (Ascent / The Shop)
const LEAF = "22PY9XYbBwQW"; // the Office job's "Office Admin" budget leaf
const TAX_RATE = 0.0835;
const UNIT_COST = 100;
const UNIT_PRICE = 118; // cost + an 18% fee, sent as a plain number

const show = (label, v) => console.log(String(label).padEnd(44), JSON.stringify(v));

if (!LIVE) {
  console.log("DRY RUN — nothing is written. Add --live to run it (owner's ok first).\n");
  [
    "read the Office job: the budget leaf, two already-voided bills on no invoice, one time entry on no invoice",
    'createDocument customerInvoice "ZZ probe — invoice create" (draft, qboIsIgnored) with a division group → bill group → one $100 / $118 line, and references to bill A and the time entry',
    "re-read bill A and the time entry: referencedDocuments → questions 1, 2",
    "re-read the invoice: groups, line, price, qboId → questions 3, 6",
    "createDocumentReference invoice → bill B, re-read bill B → question 4",
    "deleteDocumentReference for bill A, bill B and the time entry, re-read all three → question 5",
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
const refs = { referencedDocuments: { nodes: { id: {}, type: {}, status: {} } } };
const answers = {};
const r2 = (n) => Math.round(n * 100) / 100;

// ---- reads only: everything the probe needs must exist before it writes ----
const pre = await pave({
  costItem: { $: { id: LEAF }, id: {}, name: {}, job: { id: {} }, document: { id: {} } },
  job: {
    $: { id: JOB },
    documents: {
      $: {
        size: 25,
        where: { and: [eq("type", "vendorBill"), eq("status", "denied")] },
        sortBy: [{ field: "createdAt", order: "desc" }],
      },
      nodes: { id: {}, number: {}, fromName: {}, ...refs },
    },
    timeEntries: {
      $: { size: 25, sortBy: [{ field: "startedAt", order: "asc" }] },
      nodes: { id: {}, startedAt: {}, ...refs },
    },
  },
});
if (pre.costItem?.job?.id !== JOB || pre.costItem?.document?.id) {
  throw new Error("The Office Admin budget leaf is not where the probe expects it. Nothing was written.");
}
const unreferenced = (n) => (n.referencedDocuments?.nodes ?? []).length === 0;
const [billA, billB] = pre.job.documents.nodes.filter(unreferenced);
const entry = pre.job.timeEntries.nodes.find(unreferenced);
if (!billA || !billB || !entry) {
  throw new Error("Need two voided Office bills and one Office time entry on no invoice. Nothing was written.");
}
show("bill A / bill B / time entry", { billA: billA.number, billB: billB.number, entry: entry.id });

const hasInvoice = (node, invoiceId) => (node?.referencedDocuments?.nodes ?? []).some((n) => n.id === invoiceId);
const readBill = async (id) => (await pave({ document: { $: { id }, id: {}, status: {}, ...refs } })).document;
const readEntry = async (id) => (await pave({ timeEntry: { $: { id }, id: {}, ...refs } })).timeEntry;
const docSel = { id: {}, number: {}, status: {}, price: {}, cost: {}, tax: {}, priceWithTax: {}, qboId: {} };
const readInvoice = async (id) =>
  (
    await pave({
      document: {
        $: { id },
        ...docSel,
        costGroups: { $: { size: 10 }, nodes: { id: {}, name: {}, parentCostGroup: { id: {} } } },
        costItems: {
          $: { size: 10 },
          nodes: { id: {}, name: {}, cost: {}, price: {}, unitCost: {}, unitPrice: {}, costGroup: { name: {} }, jobCostItem: { id: {} } },
        },
      },
    })
  ).document;

// ---- the writes. Whatever fails, the invoice is still voided at the end. ----
let invoiceId = null;
try {
  const created = await pave({
    createDocument: {
      $: {
        type: "customerInvoice",
        jobId: JOB,
        name: "ZZ probe — invoice create",
        fromName: "Ascent Building Co.",
        toName: "ZZ probe",
        // JobTread refuses a new invoice without a job location, and wants exactly
        // one of dueDate/dueDays (probe-deposit-line.mjs, 2026-10-05).
        jobLocationName: "The Shop",
        jobLocationAddress: "4223 Center Rd, Lopez Island, WA 98261, USA",
        dueDays: 14,
        // Never reaches QuickBooks, whatever happens below.
        qboIsIgnored: true,
        taxRate: TAX_RATE,
        references: [
          { _type: "document", id: billA.id },
          { _type: "timeEntry", id: entry.id },
        ],
        // The shape JobTread's own builder leaves: division → code → bill → line.
        lineItems: [
          {
            _type: "costGroup",
            name: "ZZ probe division",
            lineItems: [
              {
                _type: "costGroup",
                name: `ZZ probe bill group (Bill 007-${billA.number})`,
                lineItems: [
                  {
                    _type: "costItem",
                    name: "ZZ probe line",
                    jobCostItemId: LEAF,
                    quantity: 1,
                    unitCost: UNIT_COST,
                    unitPrice: UNIT_PRICE,
                    isTaxable: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      createdDocument: docSel,
    },
  });
  invoiceId = created.createDocument.createdDocument.id;
  show("invoice created", created.createDocument.createdDocument);

  answers["1 references flags the bill"] = hasInvoice(await readBill(billA.id), invoiceId) ? "yes" : "NO — bill A shows no invoice";
  answers["2 references flags the time entry"] = hasInvoice(await readEntry(entry.id), invoiceId)
    ? "yes"
    : "NO — the time entry shows no invoice";

  const inv = await readInvoice(invoiceId);
  show("invoice groups", inv.costGroups.nodes.map((g) => g.name));
  show("invoice lines", inv.costItems.nodes);
  const line = inv.costItems.nodes[0];
  answers["3 groups + line land, price kept"] =
    inv.costGroups.nodes.length === 2 && line && r2(line.price) === UNIT_PRICE && r2(line.cost) === UNIT_COST && r2(inv.price) === UNIT_PRICE
      ? "yes"
      : `NO — ${inv.costGroups.nodes.length} groups, line ${JSON.stringify(line)}, invoice price ${inv.price}`;

  try {
    await pave({ createDocumentReference: { $: { documentId: invoiceId, reference: { _type: "document", id: billB.id } } } });
    answers["4 createDocumentReference flags a bill"] = hasInvoice(await readBill(billB.id), invoiceId) ? "yes" : "NO — accepted, but bill B shows no invoice";
  } catch (e) {
    answers["4 createDocumentReference flags a bill"] = `NO — ${e.message}`;
  }

  const removed = [];
  for (const [label, reference, read] of [
    ["bill A", { _type: "document", id: billA.id }, () => readBill(billA.id)],
    ["bill B", { _type: "document", id: billB.id }, () => readBill(billB.id)],
    ["time entry", { _type: "timeEntry", id: entry.id }, () => readEntry(entry.id)],
  ]) {
    try {
      if (!hasInvoice(await read(), invoiceId)) continue; // never set — nothing to remove
      await pave({ deleteDocumentReference: { $: { documentId: invoiceId, reference } } });
      removed.push(`${label}: ${hasInvoice(await read(), invoiceId) ? "STILL FLAGGED" : "cleared"}`);
    } catch (e) {
      removed.push(`${label}: FAILED — ${e.message}`);
    }
  }
  answers["5 deleteDocumentReference clears the flag"] = removed.join("; ") || "nothing was flagged";

  const end = await readInvoice(invoiceId);
  answers["6 draft stays out of QuickBooks"] = !inv.qboId && !end.qboId ? "yes — no qboId at any step" : "NO — a qboId appeared";
} finally {
  if (invoiceId) {
    await pave({ updateDocument: { $: { id: invoiceId, status: "denied" }, document: { $: { id: invoiceId }, id: {} } } });
    show("probe invoice voided", (await readInvoice(invoiceId)).status);
  }
}

console.log("\nANSWERS");
for (const [q, a] of Object.entries(answers)) show(q, a);
