import { describe, expect, it } from "vitest";
import {
  ALL_COPY_KEYS,
  COPY,
  COPY_GROUPS,
  copyByGroup,
  defaultCopy,
  fillTokens,
  pruneOverrides,
  resolveCopy,
} from "./copy";

/**
 * Editable page copy.
 *
 * The whole safety promise of this feature is that an override can only ever
 * REPLACE text, never remove it: a missing row, a blank edit, a renamed key or
 * an unreachable DB must all land on the English shipped in the code. These
 * cases are the ways that promise could break and leave a user staring at an
 * empty label — or worse, at a raw key id like `home.dest.recode.label`.
 */
describe("resolveCopy", () => {
  const key = "home.dest.recode.label";

  it("returns the shipped default when there is no override", () => {
    expect(resolveCopy({}, key)).toBe(COPY[key].text);
  });

  it("returns the override when one is set", () => {
    expect(resolveCopy({ [key]: "Monthly Billing" }, key)).toBe("Monthly Billing");
  });

  it("treats a blank override as absent — this is the revert gesture", () => {
    expect(resolveCopy({ [key]: "" }, key)).toBe(COPY[key].text);
    expect(resolveCopy({ [key]: "   " }, key)).toBe(COPY[key].text);
    expect(resolveCopy({ [key]: "\n\t" }, key)).toBe(COPY[key].text);
  });

  it("never renders a raw key id for an unknown key", () => {
    expect(resolveCopy({}, "nope.not.a.key")).toBe("");
    // Even if a stale row somehow carries one, it is not a registry key, so a
    // page asking for it gets "" rather than the id text.
    expect(defaultCopy("nope.not.a.key")).toBe("");
  });

  it("keeps a legitimately whitespace-padded edit's visible text", () => {
    expect(resolveCopy({ [key]: "  Billing  " }, key)).toBe("  Billing  ");
  });
});

describe("token substitution", () => {
  const key = "recode.empty.nothingToStage";

  it("fills a token in the shipped default", () => {
    expect(resolveCopy({}, key, { month: "August 2026" })).toContain("August 2026");
    expect(resolveCopy({}, key, { month: "August 2026" })).not.toContain("{month}");
  });

  it("fills a token in an override too", () => {
    expect(resolveCopy({ [key]: "Nothing for {month}." }, key, { month: "July" })).toBe(
      "Nothing for July.",
    );
  });

  it("leaves an unknown token visible rather than blanking it", () => {
    // A misspelled token must show the mistake, not silently drop a word.
    expect(resolveCopy({ [key]: "Nothing for {moth}." }, key, { month: "July" })).toBe(
      "Nothing for {moth}.",
    );
  });

  it("is a no-op when the text has no tokens", () => {
    expect(fillTokens("plain text", { month: "July" })).toBe("plain text");
  });

  it("accepts a reworded string that drops the token entirely", () => {
    // The editor warns about this, but it must still render — a rewording that
    // genuinely doesn't need the value is legitimate.
    expect(resolveCopy({ [key]: "Nothing to stage." }, key, { month: "July" })).toBe(
      "Nothing to stage.",
    );
  });

  it("declares tokens for every default that uses one", () => {
    for (const k of ALL_COPY_KEYS) {
      const used = [...COPY[k].text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(COPY[k].tokens ?? [], `${k} uses ${used.join(",")} but declares no tokens`).toEqual(
        expect.arrayContaining(used),
      );
    }
  });
});

describe("pruneOverrides", () => {
  it("drops keys that are no longer in the registry", () => {
    const pruned = pruneOverrides({
      "home.dest.recode.label": "Billing",
      "removed.in.a.refactor": "ghost",
    });
    expect(pruned).toEqual({ "home.dest.recode.label": "Billing" });
  });

  it("returns an empty map for an all-stale set", () => {
    expect(pruneOverrides({ "a.b": "x", "c.d": "y" })).toEqual({});
  });
});

describe("the registry itself", () => {
  it("gives every entry a non-empty default, label, and known group", () => {
    for (const k of ALL_COPY_KEYS) {
      const e = COPY[k];
      expect(e.text, `${k} has empty default text`).not.toBe("");
      expect(e.label, `${k} has empty label`).not.toBe("");
      expect(COPY_GROUPS, `${k} has an unknown group`).toContain(e.group);
    }
  });

  it("surfaces every key in exactly one editor group", () => {
    const grouped = copyByGroup().flatMap((g) => g.keys);
    expect(grouped.sort()).toEqual([...ALL_COPY_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
