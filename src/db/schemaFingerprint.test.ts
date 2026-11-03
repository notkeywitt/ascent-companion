import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SCHEMA_FINGERPRINT, fingerprintOf } from "./index";

/**
 * `ensureDb` skips the schema block when the stored marker equals
 * SCHEMA_FINGERPRINT. That constant is pinned by hand, so this test is what
 * keeps it honest: it hashes `applySchema`'s source text and fails, printing the
 * new value, when a statement changed but the constant did not.
 */
function applySchemaSource(): string {
  const lines = readFileSync(join(__dirname, "index.ts"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("async function applySchema("));
  if (start < 0) throw new Error("applySchema not found in src/db/index.ts");
  const end = lines.findIndex((l, i) => i > start && l === "}");
  if (end < 0) throw new Error("end of applySchema not found in src/db/index.ts");
  return lines.slice(start, end + 1).join("\n");
}

describe("SCHEMA_FINGERPRINT", () => {
  it("matches the applySchema source", () => {
    const actual = fingerprintOf(applySchemaSource());
    expect(
      SCHEMA_FINGERPRINT,
      `applySchema changed. Set SCHEMA_FINGERPRINT in src/db/index.ts to "${actual}".`,
    ).toBe(actual);
  });
});
