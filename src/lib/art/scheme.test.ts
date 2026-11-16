import { describe, expect, it } from "vitest";
import { ART_PRESETS, colorsFor, hexToHsl, hslToHex, parseChoice, schemeFromTwo } from "./scheme";

const arc = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe("hex ↔ hsl", () => {
  it("round-trips a colour", () => {
    expect(hslToHex(hexToHsl("#4e79a7"))).toBe("#4e79a7");
  });
});

describe("schemeFromTwo", () => {
  const out = schemeFromTwo("#C44536", "#1F6F8B");

  it("keeps the two picks first, as chosen, and makes eight in all", () => {
    expect(out).toHaveLength(8);
    expect(out.slice(0, 2)).toEqual(["#c44536", "#1f6f8b"]);
    expect(new Set(out).size).toBe(8);
  });

  it("spreads the six new hues away from the picks", () => {
    const picks = [hexToHsl(out[0]).h, hexToHsl(out[1]).h];
    for (const c of out.slice(2)) {
      expect(Math.min(...picks.map((p) => arc(p, hexToHsl(c).h)))).toBeGreaterThan(20);
    }
  });
});

describe("choices", () => {
  it("reads a stored choice, and falls back on junk", () => {
    expect(parseChoice('{"preset":"kiln"}')).toEqual({ preset: "kiln" });
    expect(parseChoice('{"two":["#000000","#ffffff"]}')).toEqual({ two: ["#000000", "#ffffff"] });
    expect(parseChoice("not json")).toBeNull();
  });

  it("gives eight colours per preset, and none for House", () => {
    expect(ART_PRESETS).toHaveLength(8);
    expect(colorsFor({ preset: "house" })).toBeNull();
    for (const p of ART_PRESETS.slice(1)) expect(colorsFor({ preset: p.id })).toHaveLength(8);
    expect(colorsFor({ two: ["#zzzzzz", "#000000"] })).toBeNull();
  });
});
