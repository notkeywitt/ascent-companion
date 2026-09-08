// Probe: does updateTimeEntry's `type` (the pay type = labor rate) change an
// existing entry's cost? Schema says type is an optional string on the update
// mutation, but nothing says whether JobTread recomputes cost = minutes x the
// membership's rate for the new type, or leaves the snapshotted cost alone.
//
// Creates a [PROBE] entry, reads it, flips its type to one at a DIFFERENT rate,
// reads it back, deletes it. Also checks what an unknown type name does.
// Run: node scripts/probe-time-entry-type.mjs ["Some Other Pay Type"]
//
// RESULT 2026-09-08: minutes 120 unchanged, hourlyRate 85 -> 95, cost 170 -> 190.
// An unknown name is HTTP 400 "Unknown time entry type 'X' for user Ty O'Steen".
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

async function pave(query) {
  const res = await fetch("https://api.jobtread.com/pave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok || json?.errors) {
    throw new Error(`HTTP ${res.status}: ${json?.errors?.map((e) => e.message).join("; ") ?? text.slice(0, 300)}`);
  }
  return json;
}

const ORG = "22PXG7QcMaQ2";
const MEMBERSHIP = "22PXYS2tWAZE";      // Ty O'Steen
const USER = "22PXYS2tWXTX";
const JOB = "22PXbuYW5YRe";             // Beach Shack - PreCon Budget
const COST_ITEM = "22PYuHfKEa7g";       // 01 31 10 Project Management

const read = (id) =>
  pave({ timeEntry: { $: { id }, id: {}, type: {}, cost: {}, minutes: {}, hourlyRate: {}, isApproved: {} } })
    .then((r) => r.timeEntry);

const m = await pave({ membership: { $: { id: MEMBERSHIP }, timeEntryTypes: { name: {}, hourlyRate: {} } } });
const types = m.membership.timeEntryTypes ?? [];
console.log("member pay types:", JSON.stringify(types));
// The switch has to be to a DIFFERENT dollar rate, or a recompute and a no-op
// look identical. "Ruhmann-Warren - PM" is $95 against Regular Pay's $85.
const TARGET = process.argv[2] || "Ruhmann-Warren - PM";
if (!types.some((t) => t.name === TARGET)) { console.log(`member has no pay type "${TARGET}"`); process.exit(1); }

const created = await pave({
  createTimeEntry: {
    $: {
      organizationId: ORG, userId: USER, jobId: JOB, costItemId: COST_ITEM,
      type: "Regular Pay",
      startedAt: "2026-09-08T17:00:00.000Z",
      endedAt: "2026-09-08T19:00:00.000Z",
      notes: "[PROBE] pay-type switch — delete me",
      isApproved: false,
    },
    createdTimeEntry: { id: {} },
  },
});
const id = created.createTimeEntry.createdTimeEntry.id;
try {
  console.log("before:", JSON.stringify(await read(id)));
  await pave({ updateTimeEntry: { $: { id, type: TARGET }, timeEntry: { $: { id }, id: {} } } });
  console.log("after :", JSON.stringify(await read(id)));
  // A type the member does NOT have — does JobTread reject it?
  try {
    await pave({ updateTimeEntry: { $: { id, type: "ZZ Not A Real Rate" }, timeEntry: { $: { id }, id: {} } } });
    console.log("bogus :", JSON.stringify(await read(id)));
  } catch (e) {
    console.log("bogus rejected:", e.message);
  }
} finally {
  await pave({ deleteTimeEntry: { $: { id } } });
  console.log("deleted probe entry", id);
}
