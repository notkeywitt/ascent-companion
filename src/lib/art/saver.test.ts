import { describe, expect, it } from "vitest";
import { randomPick } from "./saver";
import { ART_PRESETS } from "./scheme";

describe("randomPick", () => {
  it("only picks dated data sets, with a grouping that set has", () => {
    let s = 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const p = randomPick(rand);
      expect(["bills", "labor"]).toContain(p.set);
      if (p.set === "labor") expect(["job", "person", "division"]).toContain(p.by);
      else expect(["job", "vendor", "division", "type"]).toContain(p.by);
      expect(ART_PRESETS.map((x) => x.id)).toContain(p.preset);
    }
  });
});
