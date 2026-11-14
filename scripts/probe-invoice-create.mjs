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
//   7. Does a past issueDate (the last day of a billing month) stick, under the
//      "Monthly Invoice" template name?
//
// JobTread refuses a customer invoice on the Office job (007): "Customer orders
// and invoices can only be created for fixed-price or cost-plus jobs", and 007
// has no price type. So the invoice goes on the owner's test job (Job 37,
// customer "Tester", cost-plus). A first run pointed the references at Office
// records: createDocument dropped them silently and createDocumentReference
// answered "Invalid reference document ID", so a reference must stay on the
// invoice's own job (or must not be a voided bill; that run could not tell).
// The owner then put one bill and one time entry on Job 37 by hand. Writes:
//   - on Job 37: one $0 "ZZ probe" budget leaf if the job has none (it stays),
//     and one "ZZ probe" draft customer invoice, VOIDED at the end (status
//     denied, never deleted; see CLAUDE.md);
//   - references from it to that bill and that time entry. The probe removes
//     every reference before it voids the invoice.
// It creates no bill and no time entry. The connector's grant is read-only, so
// this uses the app's key from
// .env.local, like probe-deposit-line.mjs.
// Dry by default — prints the plan and exits:
//   node scripts/probe-invoice-create.mjs
// Live (owner's ok first):
//   node scripts/probe-invoice-create.mjs --live
import fs from "node:fs";

const LIVE = process.argv.includes("--live");
const JOB = "22Pi4qW5bdmr"; // Job 37 (customer "Tester", cost-plus) — holds the probe invoice
const CODE_CONSUMABLES = "22PXGEz4rPUw"; // 01 31 30 Consumables, for the $0 leaf
const COST_TYPE = "22PXG7Zt8iGY"; // Labor — the type the Office Admin leaf uses; any type does for a $0 leaf
const TAX_RATE = 0.0835;
const ISSUE_DATE = "2026-10-31"; // the last day of a past billing month
const UNIT_COST = 100;
const UNIT_PRICE = 118; // cost + an 18% fee, sent as a plain number

const show = (label, v) => console.log(String(label).padEnd(44), JSON.stringify(v));

if (!LIVE) {
  console.log("DRY RUN — nothing is written. Add --live to run it (owner's ok first).\n");
  [
    "read Job 37: cost-plus, a budget leaf (create a $0 one if it has none), one bill on no invoice, one time entry on no invoice",
    'createDocument customerInvoice "Invoice" to "ZZ probe" (draft, qboIsIgnored) with a division group → bill group → one $100 / $118 line, and references to the bill and the time entry',
    "re-read the bill and the time entry: referencedDocuments → questions 1, 2",
    "re-read the invoice: groups, line, price, qboId → questions 3, 6",
    "deleteDocumentReference for the bill and the time entry, re-read both → question 5",
    "createDocumentReference invoice → the bill again, re-read it → question 4, then remove it again",
    "updateDocument status pending, then denied (the void) — the probe invoice is never deleted",
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
  job: {
    $: { id: JOB },
    priceType: {},
    costItems: { $: { size: 1, where: eq(["document", "id"], null) }, nodes: { id: {}, name: {} } },
    documents: {
      $: {
        size: 25,
        where: { and: [eq("type", "vendorBill"), { "!=": [{ field: "status" }, { value: "denied" }] }] },
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
if (!["costPlus", "fixed"].includes(pre.job?.priceType)) {
  throw new Error("Job 37 is not cost-plus or fixed-price, so JobTread refuses an invoice on it. Nothing was written.");
}
const unreferenced = (n) => (n.referencedDocuments?.nodes ?? []).length === 0;
const billA = pre.job.documents.nodes.find(unreferenced);
const entry = pre.job.timeEntries.nodes.find(unreferenced);
if (!billA || !entry) {
  throw new Error("Need one bill and one time entry on Job 37, each on no invoice. Nothing was written.");
}
show("bill / time entry", { bill: billA.number, entry: entry.id });

// The first write, and only after every read passed: a line needs a budget leaf
// on the invoice's own job.
const LEAF =
  pre.job.costItems.nodes[0]?.id ??
  (
    await pave({
      createCostItem: {
        // JobTread refuses a budget leaf without a cost type ("A costTypeId is required").
        $: { jobId: JOB, costCodeId: CODE_CONSUMABLES, costTypeId: COST_TYPE, name: "ZZ probe — Consumables", quantity: 0, unitCost: 0, isTaxable: false },
        createdCostItem: { id: {} },
      },
    })
  ).createCostItem.createdCostItem.id;
show("budget leaf on Job 37", LEAF);

const hasInvoice = (node, invoiceId) => (node?.referencedDocuments?.nodes ?? []).some((n) => n.id === invoiceId);
const readBill = async (id) => (await pave({ document: { $: { id }, id: {}, status: {}, ...refs } })).document;
const readEntry = async (id) => (await pave({ timeEntry: { $: { id }, id: {}, ...refs } })).timeEntry;
const docSel = { id: {}, number: {}, status: {}, price: {}, cost: {}, tax: {}, priceWithTax: {}, qboId: {}, name: {}, issueDate: {} };
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
        // JobTread refuses a free name: "Name must be one of Deposit, Invoice,
        // Monthly Invoice, …" (the org's document templates). toName marks the probe.
        name: "Monthly Invoice",
        fromName: "Ascent Building Co.",
        toName: "ZZ probe",
        // JobTread refuses a new invoice without a job location, and wants exactly
        // one of dueDate/dueDays (probe-deposit-line.mjs, 2026-10-05).
        jobLocationName: "1361 Davis Bay Road",
        jobLocationAddress: "1361 Davis Bay Rd, Lopez Island, WA 98261, USA",
        dueDays: 14,
        // The app dates a draft the last day of its billing month, not today.
        issueDate: ISSUE_DATE,
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
                name: `ZZ probe bill group (Bill ${billA.number})`,
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

  const removeAll = async () => {
    const removed = [];
    for (const [label, reference, read] of [
      ["bill", { _type: "document", id: billA.id }, () => readBill(billA.id)],
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
    return removed.join("; ") || "nothing was flagged";
  };
  answers["5 deleteDocumentReference clears the flag"] = await removeAll();

  // Job 37 holds one bill, so question 4 re-adds the reference question 5 removed.
  try {
    await pave({ createDocumentReference: { $: { documentId: invoiceId, reference: { _type: "document", id: billA.id } } } });
    answers["4 createDocumentReference flags a bill"] = hasInvoice(await readBill(billA.id), invoiceId) ? "yes" : "NO — accepted, but the bill shows no invoice";
  } catch (e) {
    answers["4 createDocumentReference flags a bill"] = `NO — ${e.message}`;
  }
  show("references removed after question 4", await removeAll());

  const end = await readInvoice(invoiceId);
  answers["6 draft stays out of QuickBooks"] = !inv.qboId && !end.qboId ? "yes — no qboId at any step" : "NO — a qboId appeared";
  answers["7 issueDate and template name kept"] =
    end.issueDate === ISSUE_DATE && end.name === "Monthly Invoice" ? "yes" : `NO — ${end.name}, ${end.issueDate}`;
} finally {
  // Answers first: a failed void must not hide them.
  console.log("\nANSWERS");
  for (const [q, a] of Object.entries(answers)) show(q, a);
  if (invoiceId) {
    // JobTread refuses draft → denied ("Status cannot be changed from draft to
    // denied"), so the void goes by way of pending.
    for (const status of ["pending", "denied"]) {
      await pave({ updateDocument: { $: { id: invoiceId, status }, document: { $: { id: invoiceId }, id: {} } } });
    }
    show("probe invoice voided", (await readInvoice(invoiceId)).status);
  }
}
