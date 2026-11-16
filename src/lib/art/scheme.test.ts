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

  it("starts with each pick's complement, then the midpoint between them", () => {
    // Red and blue, a third of the wheel apart (not complements of each other).
    const two = schemeFromTwo("#c44536", "#3d7dd8");
    const [ha, hb] = [hexToHsl(two[0]).h, hexToHsl(two[1]).h];
    expect(arc(hexToHsl(two[2]).h, ha + 180)).toBeLessThan(4);
    expect(arc(hexToHsl(two[3]).h, hb + 180)).toBeLessThan(4);
    const mids = two.slice(2).map((c) => hexToHsl(c).h);
    const d = ((hb - ha + 540) % 360) - 180;
    expect(Math.min(...mids.map((h) => arc(h, ha + d / 2)))).toBeLessThan(4);
  });

  it("skips a complement that would sit on the other pick", () => {
    // Red and teal are near complements: red's complement is teal's twin.
    const hs = out.map((c) => hexToHsl(c).h);
    for (const h of hs.slice(2)) expect(arc(h, hs[1])).toBeGreaterThanOrEqual(20);
  });

  it("keeps every hue apart, and builds a palette from two greys too", () => {
    const hs = out.map((c) => hexToHsl(c).h);
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) expect(arc(hs[i], hs[j])).toBeGreaterThan(15);
    const greys = schemeFromTwo("#777777", "#999999");
    expect(new Set(greys).size).toBe(8);
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
