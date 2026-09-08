// Probe: does writing `nonRecoverableTaxName: null` turn JobTread's "Record Tax"
// toggle off? Sales tax is an 88 80 00 cost item now (src/lib/salesTax.ts), so the
// document tax row must not exist, and `setBillTax` clears the name with the field.
// This is the one live check of that write.
//
// Reads the bill, writes the pair, reads it back, then restores the name it found.
// Run: node scripts/probe-record-tax.mjs [docId]
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
const DOC_ID = process.argv[2] || "22PdwYuQV3VB";
const RESTORE = process.argv[3] === "--restore";

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
    throw new Error(
      `HTTP ${res.status}: ${json?.errors?.map((e) => e.message).join("; ") ?? text.slice(0, 200)}`,
    );
  }
  return json;
}

const sel = {
  id: {},
  number: {},
  status: {},
  cost: {},
  nonRecoverableTax: {},
  nonRecoverableTaxName: {},
};
const read = async () => (await pave({ document: { $: { id: DOC_ID }, ...sel } })).document;

const before = await read();
console.log("BEFORE ", before);

if (RESTORE) {
  await pave({
    updateDocument: {
      $: { id: DOC_ID, nonRecoverableTaxName: "Tax" },
      document: { $: { id: DOC_ID }, id: {} },
    },
  });
  console.log("RESTORED", await read());
  process.exit(0);
}

await pave({
  updateDocument: {
    $: { id: DOC_ID, nonRecoverableTax: 0, nonRecoverableTaxName: null },
    document: { $: { id: DOC_ID }, id: {} },
  },
});
const after = await read();
console.log("AFTER  ", after);
console.log(
  after.nonRecoverableTaxName === null
    ? `\nOK: name is null. cost ${before.cost} -> ${after.cost}. Check the toggle in JobTread.`
    : `\nNOT CLEARED: name is ${JSON.stringify(after.nonRecoverableTaxName)}.`,
);
