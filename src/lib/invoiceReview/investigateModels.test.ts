/**
 * The model allowlist.
 *
 * This is a cost guard as much as a correctness one: the id arrives from the
 * browser, and the call it selects is the most expensive in the app. What is
 * pinned here is mostly what must NOT get through.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_INVESTIGATE_MODEL,
  INVESTIGATE_MODELS,
  investigateModel,
  isInvestigateModel,
  resolveInvestigateModel,
} from "./investigateModels";

const ENV = process.env.ANTHROPIC_MODEL_INVESTIGATE;
afterEach(() => {
  if (ENV === undefined) delete process.env.ANTHROPIC_MODEL_INVESTIGATE;
  else process.env.ANTHROPIC_MODEL_INVESTIGATE = ENV;
});

describe("the list itself", () => {
  it("defaults to Sonnet — most months do not need Opus", () => {
    expect(DEFAULT_INVESTIGATE_MODEL).toBe("claude-sonnet-5");
    expect(isInvestigateModel(DEFAULT_INVESTIGATE_MODEL)).toBe(true);
  });

  it("offers no model that strips prior-turn thinking blocks", () => {
    // Haiku 4.5 and earlier drop them, so every turn after the first would fall
    // out of the conversation cache — a "cheaper" model that costs more in this
    // loop. The comment in investigate.ts explains it; this keeps it true.
    for (const m of INVESTIGATE_MODELS) expect(m.id).not.toMatch(/haiku/i);
  });

  it("gives every model a cost estimate to show before the button is pressed", () => {
    for (const m of INVESTIGATE_MODELS) {
      expect(m.busyMonthEstimate.trim()).not.toBe("");
      expect(m.outputPerMTok).toBeGreaterThan(0);
    }
  });
});

describe("resolveInvestigateModel", () => {
  it("accepts a model on the list", () => {
    expect(resolveInvestigateModel("claude-opus-5")).toBe("claude-opus-5");
  });

  it("REFUSES anything off the list, falling back rather than passing it through", () => {
    // The one that matters. A free-text model id from the browser would let
    // anyone with access point the priciest call in the app wherever they like.
    expect(resolveInvestigateModel("claude-fable-5")).toBe(DEFAULT_INVESTIGATE_MODEL);
    expect(resolveInvestigateModel("gpt-4")).toBe(DEFAULT_INVESTIGATE_MODEL);
    expect(resolveInvestigateModel("")).toBe(DEFAULT_INVESTIGATE_MODEL);
    expect(resolveInvestigateModel(undefined)).toBe(DEFAULT_INVESTIGATE_MODEL);
  });

  it("honours the env override when it is on the list", () => {
    process.env.ANTHROPIC_MODEL_INVESTIGATE = "claude-opus-5";
    expect(resolveInvestigateModel(undefined)).toBe("claude-opus-5");
  });

  it("ignores an env override that is NOT on the list", () => {
    // A typo in a Vercel env var must not take the feature down.
    process.env.ANTHROPIC_MODEL_INVESTIGATE = "claude-opus-5-typo";
    expect(resolveInvestigateModel(undefined)).toBe(DEFAULT_INVESTIGATE_MODEL);
  });

  it("lets an explicit choice beat the env default", () => {
    process.env.ANTHROPIC_MODEL_INVESTIGATE = "claude-opus-5";
    expect(resolveInvestigateModel("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("tolerates stray whitespace around a real id", () => {
    expect(resolveInvestigateModel("  claude-opus-5  ")).toBe("claude-opus-5");
  });
});

describe("investigateModel", () => {
  it("finds a listed model's display detail", () => {
    expect(investigateModel("claude-sonnet-5")?.label).toBe("Sonnet");
  });

  it("returns undefined for an unknown id, so the UI can fall back", () => {
    expect(investigateModel("nope")).toBeUndefined();
  });
});
