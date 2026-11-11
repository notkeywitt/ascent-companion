import { describe, expect, it } from "vitest";

import { isNewBuildLive } from "./versionCheck";

describe("isNewBuildLive", () => {
  it("is true when the server runs a different build", () => {
    expect(isNewBuildLive("aaa111", "bbb222")).toBe(true);
  });
  it("is false when the builds match", () => {
    expect(isNewBuildLive("aaa111", "aaa111")).toBe(false);
  });
  it("is false when either side is unknown", () => {
    expect(isNewBuildLive("", "bbb222")).toBe(false);
    expect(isNewBuildLive("aaa111", "")).toBe(false);
    expect(isNewBuildLive("aaa111", undefined)).toBe(false);
    expect(isNewBuildLive("aaa111", 42)).toBe(false);
  });
});
