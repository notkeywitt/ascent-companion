import { describe, expect, it } from "vitest";

import { costOf, tokensOf } from "./aiUsage";

describe("costOf", () => {
  it("prices a Sonnet 5 review summary from its usage", () => {
    // 9,000 tokens in at $2/M + 1,200 out at $10/M = 1.8¢ + 1.2¢.
    const t = tokensOf({ input_tokens: 9000, output_tokens: 1200 } as never);
    expect(costOf("claude-sonnet-5", t)).toBeCloseTo(0.03, 6);
  });

  it("prices cache writes at 1.25x and reads at 0.1x input", () => {
    expect(costOf("claude-sonnet-5", { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000 })).toBeCloseTo(2.7, 6);
  });

  it("returns null for a model with no price, so it is never read as free", () => {
    expect(costOf("claude-unknown-9", { input: 100, output: 100, cacheWrite: 0, cacheRead: 0 })).toBeNull();
  });
});
