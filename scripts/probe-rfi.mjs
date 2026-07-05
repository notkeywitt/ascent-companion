// READ-ONLY discovery: which JobTread object can hold an RFI?
// Probes a job's candidate sub-connections (to-dos, tasks, daily logs, forms,
// comments) and the org's custom-field target types. Run: node scripts/probe-rfi.mjs
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
const orgId = env.JT_ORG_ID;
const JOB_ID = process.argv[2] || "22PXGG97EiV4";

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
  return { ok: res.ok && !json?.errors, status: res.status, json, text };
}

const err = (r) =>
  r.json?.errors ? r.json.errors.map((e) => e.message).join("; ") : r.text?.slice(0, 120);

console.log(`\n=== Job sub-connections that could hold RFIs (job ${JOB_ID}) ===`);
for (const conn of ["toDos", "jobToDos", "tasks", "jobTasks", "dailyLogs", "forms", "formSubmissions", "comments"]) {
  const r = await pave({
    job: { $: { id: JOB_ID }, id: {}, [conn]: { $: { size: 2 }, nodes: { id: {}, name: {} } } },
  });
  if (r.ok) {
    const nodes = r.json?.job?.[conn]?.nodes ?? [];
    console.log(`  ✅ job.${conn.padEnd(16)} EXISTS (${nodes.length} sample) ${nodes[0] ? JSON.stringify(nodes[0]) : ""}`);
  } else {
    console.log(`  ❌ job.${conn.padEnd(16)} ${err(r)?.slice(0, 80)}`);
  }
}

console.log(`\n=== Org custom fields (targetType shows which objects support custom fields) ===`);
const cf = await pave({
  organization: {
    $: { id: orgId },
    id: {},
    customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, type: {}, targetType: {} } },
  },
});
if (cf.ok) {
  const nodes = cf.json?.organization?.customFields?.nodes ?? [];
  const byTarget = {};
  for (const n of nodes) (byTarget[n.targetType] ??= []).push(n.name);
  for (const [t, names] of Object.entries(byTarget)) {
    console.log(`  targetType=${t}: ${names.length} field(s) — e.g. ${names.slice(0, 4).join(", ")}`);
  }
} else {
  console.log(`  ❌ customFields: ${err(cf)}`);
}

console.log("\n=== done ===");
