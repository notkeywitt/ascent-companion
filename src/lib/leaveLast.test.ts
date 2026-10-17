import { describe, expect, it } from "vitest";
import { isLeaveLine, leaveLast } from "./leaveLast";

const items = [
  { id: "a", name: "PTO - Request" },
  { id: "b", name: "Framing" },
  { id: "c", name: "Sick Time - Request" },
  { id: "d", name: "Office Admin" },
  { id: "e", name: "Leave", detail: null },
];

describe("leaveLast", () => {
  it("moves PTO and Sick Time to the end, keeping both groups' order", () => {
    expect(leaveLast(items, []).map((i) => i.id)).toEqual(["b", "d", "e", "a", "c"]);
  });

  it("moves a configured leave line whatever its name", () => {
    expect(leaveLast(items, ["e"]).map((i) => i.id)).toEqual(["b", "d", "a", "c", "e"]);
  });
});

describe("isLeaveLine", () => {
  it("does not match a word that only contains the letters", () => {
    expect(isLeaveLine({ id: "x", name: "Optometry sickle" }, [])).toBe(false);
  });

  it("reads the line's detail too", () => {
    expect(isLeaveLine({ id: "x", name: "Overhead", detail: "Sick pay" }, [])).toBe(true);
  });
});
