import { describe, expect, it } from "vitest";

import { completeOrder, moveAmong } from "./reorder";

describe("moveAmong", () => {
  it("swaps with the next shown neighbour, skipping hidden ones", () => {
    expect(moveAmong(["a", "b", "c", "d"], ["a", "c", "d"], "a", 1)).toEqual(["c", "b", "a", "d"]);
  });
  it("does nothing at the ends", () => {
    expect(moveAmong(["a", "b"], ["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveAmong(["a", "b"], ["a", "b"], "b", 1)).toEqual(["a", "b"]);
  });
});

describe("completeOrder", () => {
  it("drops unknown ids and appends new ones", () => {
    expect(completeOrder(["c", "x", "a"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
    expect(completeOrder(null, ["a", "b"])).toEqual(["a", "b"]);
  });
});
