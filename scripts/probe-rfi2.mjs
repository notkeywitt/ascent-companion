// READ-ONLY: how rich is a JobTread Task (for modelling an RFI)? + find to-dos.
import fs from "node:fs";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const grantKey = env.JT_GRANT_KEY;
const JOB_ID = process.argv[2] || "22PXGG97EiV4";

async function pave(query) {
  const res = await fetch("https://api.jobtread.com/pave", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } }),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: res.ok && !json?.errors, json, text };
}
const err = (r) => (r.json?.errors ? r.json.errors.map((e) => e.message).join("; ") : r.text?.slice(0, 100));

console.log(`\n=== Candidate Task fields (job ${JOB_ID}) — which exist for RFI modelling ===`);
for (const [field, sub] of [
  ["description", "{}"], ["startDate", "{}"], ["endDate", "{}"], ["endDateTime", "{}"],
  ["progress", "{}"], ["isDone", "{}"], ["completed", "{}"], ["priority", "{}"],
  ["taskType", "{ id: {}, name: {} }"], ["type", "{}"], ["createdAt", "{}"],
  ["assignments", "{ nodes: { id: {} } }"], ["assignees", "{ nodes: { id: {} } }"],
]) {
  const nodeSel = `{ id: {}, ${field}: ${sub} }`;
  const q = JSON.parse(
    `{ "job": { "$": { "id": "${JOB_ID}" }, "id": {}, "tasks": { "$": { "size": 3 }, "nodes": ${toJson(nodeSel)} } } }`,
  );
  const r = await pave(q);
  if (r.ok) {
    const n = (r.json?.job?.tasks?.nodes ?? []).find((x) => x[field] != null && x[field] !== "");
    console.log(`  ✅ task.${field.padEnd(12)} ${n ? JSON.stringify(n[field]).slice(0, 70) : "(present, empty on samples)"}`);
  } else {
    console.log(`  ❌ task.${field.padEnd(12)} ${err(r)?.slice(0, 70)}`);
  }
}

console.log(`\n=== Hunt for a to-do / checklist connection on the job ===`);
for (const conn of ["toDoList", "toDoLists", "checklists", "todos", "todoItems", "toDoItems", "checklistItems"]) {
  const r = await pave({ job: { $: { id: JOB_ID }, id: {}, [conn]: { $: { size: 1 }, nodes: { id: {} } } } });
  console.log(`  ${r.ok ? "✅" : "❌"} job.${conn.padEnd(14)} ${r.ok ? "EXISTS" : (err(r)?.slice(0, 60))}`);
}

console.log("\n=== done ===");

// helper: turn a loose "{ a: {}, b: {} }" node selection into JSON
function toJson(sel) {
  return sel
    .replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '"$1":')
    .replace(/\{\s*\}/g, "{}");
}
