#!/usr/bin/env node
/**
 * Mirror src/lib/billing-vectors.json into the Apps Script repo as
 * BillingVectors.js, so both implementations of deriveBillingPeriod() are
 * checked against the SAME table.
 *
 * The fixture in this repo is the source of truth. Edit it here, run this, and
 * commit both repos.
 *
 *   node scripts/gen-billing-vectors.mjs [path-to-ascent-appscript]
 *
 * Emits DATA ONLY. The function that consumes it (diagnoseBillingPeriodVectors)
 * is hand-written in Diagnostics.js, so regenerating can never clobber logic.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../src/lib/billing-vectors.json");
const target = resolve(process.argv[2] ?? resolve(here, "../../ascent-appscript"));

if (!existsSync(target)) {
  console.error(`!! Apps Script repo not found at ${target}`);
  console.error("   Pass its path: node scripts/gen-billing-vectors.mjs ../ascent-appscript");
  process.exit(1);
}

const raw = readFileSync(fixturePath, "utf8");
const { vectors } = JSON.parse(raw);
const sha = createHash("sha256").update(raw).digest("hex").slice(0, 12);

const rows = vectors
  .map((v) => {
    const j = (s) => JSON.stringify(s);
    return (
      `  { name: ${j(v.name)}, receivedUtc: ${j(v.receivedUtc)}, ` +
      `isSunset: ${v.isSunset}, billingMonthNum: ${v.billingMonthNum}, billingYear: ${v.billingYear} }`
    );
  })
  .join(",\n");

const out = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Golden vectors for the billing-period rule, mirrored from the Companion repo:
 *   ascent-companion/src/lib/billing-vectors.json   (source of truth)
 *   ascent-companion/scripts/gen-billing-vectors.mjs (this generator)
 *
 * Source fixture sha256: ${sha}
 *
 * deriveBillingPeriod() lives twice — here in Config.js and in the Companion's
 * src/lib/billing.ts — and both files warn that re-deriving the rule from
 * scratch has caused real production bugs. This table is the contract between
 * them: the Companion asserts it in \`npm test\`, and this repo asserts it in CI
 * (.github/check-billing-vectors.mjs) and from the Run dropdown via
 * diagnoseBillingPeriodVectors() in Diagnostics.js.
 *
 * To change the rule: edit the fixture in the Companion, re-run the generator,
 * and commit BOTH repos. Editing this file alone will be overwritten.
 *
 * \`receivedUtc\` is a UTC instant, not a calendar date — the rule is evaluated in
 * America/Los_Angeles, so several vectors sit either side of that boundary.
 */
const BILLING_VECTORS_SHA = "${sha}";

const BILLING_VECTORS = [
${rows}
];
`;

writeFileSync(resolve(target, "BillingVectors.js"), out);
console.log(`Wrote ${vectors.length} vectors (fixture sha ${sha}) to ${target}/BillingVectors.js`);
