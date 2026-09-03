/**
 * The FINANCIAL JOURNAL's pure half.
 *
 * The DB half is best-effort by contract (it swallows every error so it can
 * never fail a bill save), which leaves nothing to assert about it. What IS
 * worth pinning is the part that decides WHAT gets written: a value that
 * silently truncates the wrong way, a diff that records non-changes, or a
 * redactor that lets a grant key through would each corrupt the record rather
 * than lose it.
 */
import { describe, expect, it } from "vitest";
import {
  describeEvent,
  diffFields,
  MAX_VALUE_CHARS,
  newRequestId,
  redactMeta,
  valueToText,
} from "./financialJournal";

describe("valueToText", () => {
  it("keeps scalars readable rather than JSON-quoting them", () => {
    // The journal is mostly scalars. `"142.75"` in the column would be noise on
    // every row.
    expect(valueToText(142.75)).toBe("142.75");
    expect(valueToText("approved")).toBe("approved");
    expect(valueToText(true)).toBe("true");
    expect(valueToText(0)).toBe("0");
  });

  it("treats null and undefined as empty, not as the word null", () => {
    // An absent value and an empty one read the same in the column on purpose:
    // the distinction lives in `beforeSource`, which is the one that matters.
    expect(valueToText(null)).toBe("");
    expect(valueToText(undefined)).toBe("");
  });

  it("keeps a zero, which is a real amount", () => {
    // The falsy trap: a tax of 0 must not be recorded as "not captured".
    expect(valueToText(0)).not.toBe("");
    expect(valueToText(false)).toBe("false");
  });

  it("serializes an object", () => {
    expect(valueToText({ code: "06 10 00", cost: 12.5 })).toBe(
      '{"code":"06 10 00","cost":12.5}',
    );
  });

  it("truncates a runaway value and says so", () => {
    const text = valueToText("x".repeat(MAX_VALUE_CHARS + 500));
    expect(text.length).toBeLessThan(MAX_VALUE_CHARS + 40);
    expect(text.endsWith("…[truncated]")).toBe(true);
  });

  it("survives a value that cannot be serialized", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(valueToText(cyclic)).toBe("[unserializable]");
  });
});

describe("redactMeta", () => {
  it("drops anything whose key looks like a credential", () => {
    const out = redactMeta({
      vendor: "Island Custom Woodworks",
      grantKey: "live-key",
      API_KEY: "nope",
      authToken: "nope",
      cookie: "nope",
    });
    expect(out).toContain("Island Custom Woodworks");
    expect(out).not.toContain("live-key");
    expect(out).not.toContain("nope");
  });

  it("returns an empty object for no meta", () => {
    expect(redactMeta(undefined)).toBe("{}");
  });

  it("refuses to store an oversized blob", () => {
    const out = redactMeta({ blob: "y".repeat(MAX_VALUE_CHARS * 2) });
    expect(out).toBe('{"truncated":true}');
  });
});

describe("diffFields", () => {
  const base = { action: "bill.fields.set", entity: "bill", entityId: "d1" };

  it("records only the fields that actually changed", () => {
    // The bill page sends its whole header on every save. Without this, the
    // journal would fill with "issueDate: same → same" and nobody would read it.
    const events = diffFields(
      { name: "Bill", qboIsIgnored: false, issueDate: "2026-07-31" },
      { name: "Expense", qboIsIgnored: false, issueDate: "2026-07-31" },
      base,
    );
    expect(events).toHaveLength(1);
    expect(events[0].field).toBe("name");
    expect(events[0].before).toBe("Bill");
    expect(events[0].after).toBe("Expense");
  });

  it("treats a flipped boolean as a change", () => {
    // The QuickBooks push flag is a boolean, and it decides whether a cost ever
    // reaches the books. It must never be diffed away.
    const events = diffFields({ qboIsIgnored: false }, { qboIsIgnored: true }, base);
    expect(events).toHaveLength(1);
    expect(events[0].after).toBe(true);
  });

  it("records every field when there is no before-map at all", () => {
    // A failed snapshot read must not silence the record; the caller marks it
    // beforeSource "none".
    const events = diffFields(undefined, { name: "Expense", qboIsIgnored: true }, base);
    expect(events).toHaveLength(2);
  });

  it("skips a field the caller did not send", () => {
    // `fields` is built with optional keys, so undefined means "not part of
    // this write" — not "cleared".
    const events = diffFields({ name: "Bill" }, { name: undefined, qboIsIgnored: true }, base);
    expect(events.map((e) => e.field)).toEqual(["qboIsIgnored"]);
  });

  it("carries the caller's base fields onto every row", () => {
    const events = diffFields(undefined, { a: 1, b: 2 }, base);
    expect(events.every((e) => e.entityId === "d1" && e.action === "bill.fields.set")).toBe(true);
  });

  it("compares by stored text, so 1 and \"1\" are not a change", () => {
    // Both sides end up as text in the column. Reporting a type change as a
    // value change would be a false entry.
    expect(diffFields({ quantity: 1 }, { quantity: "1" }, base)).toHaveLength(0);
  });
});

describe("describeEvent", () => {
  it("shows a field change as from → to", () => {
    expect(
      describeEvent({
        action: "bill.tax.set",
        field: "nonRecoverableTax",
        before: "0",
        after: "12.44",
        beforeSource: "read",
      }),
    ).toBe("bill.tax.set · nonRecoverableTax: 0 → 12.44");
  });

  it("marks an uncaptured prior value as unknown rather than empty", () => {
    // "→ 12.44 from (empty)" would be a claim. "?" is the truth.
    expect(
      describeEvent({
        action: "bill.tax.set",
        field: "nonRecoverableTax",
        before: "",
        after: "12.44",
        beforeSource: "none",
      }),
    ).toBe("bill.tax.set · nonRecoverableTax: ? → 12.44");
  });

  it("distinguishes a genuinely empty prior value from an uncaptured one", () => {
    expect(
      describeEvent({
        action: "bill.externalId.set",
        field: "externalId",
        before: "",
        after: "INV-901",
        beforeSource: "read",
      }),
    ).toBe("bill.externalId.set · externalId: (empty) → INV-901");
  });

  it("renders a whole-record action as just the verb", () => {
    expect(
      describeEvent({
        action: "line.delete",
        field: "",
        before: '{"cost":412}',
        after: "",
        beforeSource: "read",
      }),
    ).toBe("line.delete");
  });
});

describe("newRequestId", () => {
  it("gives a different id each call, so two actions never merge", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
    expect(ids.size).toBe(50);
    expect([...ids].every((id) => id.length > 0)).toBe(true);
  });
});
