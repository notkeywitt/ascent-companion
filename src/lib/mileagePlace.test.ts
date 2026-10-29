import { describe, expect, it } from "vitest";

import { KNOWN_PLACES, placeLabel, resolvePlace, type PlaceJob } from "./mileagePlace";

const SHOP_ADDR = "4223 Center Rd, Lopez Island, WA 98261, USA";
const jobs: PlaceJob[] = [
  { id: "o", name: "Office", number: "1", customer: "Ascent", address: SHOP_ADDR },
  { id: "s", name: "Shop", number: "2", customer: "Ascent", address: SHOP_ADDR },
  { id: "e", name: "Electrical", number: "3", customer: "Ascent", address: SHOP_ADDR },
  { id: "b", name: "Main House", number: "142", customer: "Kevin Berger", address: "1 Spring St, Friday Harbor, WA 98250, USA" },
  { id: "g", name: "Main House", number: "150", customer: "Ann Gormley", address: "" },
  { id: "x", name: "Dental Office Remodel", number: "160", customer: "Island Dental", address: "9 Argyle Ave, Friday Harbor, WA" },
];

const hit = (text: string) => {
  const m = resolvePlace(text, jobs);
  return m.kind === "named" ? (m.job?.id ?? m.label) : m.kind;
};

describe("resolvePlace", () => {
  it("finds Office and Shop however they are typed", () => {
    expect(hit("Office")).toBe("o");
    expect(hit("the office")).toBe("o");
    expect(hit("SHOP")).toBe("s");
    expect(hit("The Shop")).toBe("s");
    expect(hit("Ascent - Shop")).toBe("s");
  });

  it("returns the job's address without the USA tail", () => {
    const m = resolvePlace("shop", jobs);
    expect(m).toMatchObject({ kind: "named", label: "Shop", address: "4223 Center Rd, Lopez Island, WA 98261" });
  });

  it("finds a job by customer, by label, or by number", () => {
    expect(hit("Berger")).toBe("b");
    expect(hit("the Berger job")).toBe("b");
    expect(hit("Berger's")).toBe("b");
    expect(hit("Kevin Berger - Main House")).toBe("b");
    expect(hit("#150")).toBe("g");
    expect(hit("job 142")).toBe("b");
  });

  it("asks when the text fits several jobs", () => {
    const m = resolvePlace("main house", jobs);
    expect(m.kind).toBe("ambiguous");
    expect(m.kind === "ambiguous" && m.jobs.map((j) => j.id)).toEqual(["b", "g"]);
  });

  it("leaves an address alone", () => {
    expect(hit("100 Spring St, Friday Harbor, WA")).toBe("none");
    expect(hit("Home Depot Burlington")).toBe("none");
    expect(hit("142")).toBe("none");
    expect(hit("48.53,-123.01")).toBe("none");
    expect(hit("  ")).toBe("none");
  });

  it("reports a job with no address as a match with an empty address", () => {
    expect(resolvePlace("Gormley", jobs)).toMatchObject({ kind: "named", address: "" });
  });
});

describe("known places", () => {
  it("finds the crew's regular stops by the names they use", () => {
    expect(hit("Sunset")).toBe("Sunset Builders Supply");
    expect(hit("sunset builders")).toBe("Sunset Builders Supply");
    expect(hit("Blossom")).toBe("Blossom Grocery");
    expect(hit("blossom grocery")).toBe("Blossom Grocery");
    expect(hit("LVM")).toBe("Lopez Village Market");
    expect(hit("the village market")).toBe("Lopez Village Market");
    expect(hit("the dump")).toBe("Lopez Dump");
    expect(hit("Dump")).toBe("Lopez Dump");
    expect(hit("transfer station")).toBe("Lopez Dump");
  });

  it("routes a known place to its street address", () => {
    expect(resolvePlace("the dump", jobs)).toMatchObject({
      kind: "named",
      address: "2419 Fisherman Bay Rd, Lopez Island, WA 98261",
    });
    expect(resolvePlace("lvm", jobs)).not.toHaveProperty("job");
  });

  it("lets a known place's name win over a job that shares a word", () => {
    const withSunsetJob = [...jobs, { id: "z", name: "Sunset Deck", customer: "Lee", address: "5 A St" }];
    expect(resolvePlace("sunset", withSunsetJob)).toMatchObject({ label: "Sunset Builders Supply" });
    expect(resolvePlace("sunset deck", withSunsetJob)).toMatchObject({ job: { id: "z" } });
  });

  it("every known place resolves by its own label", () => {
    for (const p of KNOWN_PLACES) {
      expect(resolvePlace(p.label, jobs)).toMatchObject({ kind: "named", label: p.label, address: p.address });
    }
  });
});

describe("placeLabel", () => {
  it("names Ascent's own jobs plainly and others by customer", () => {
    expect(placeLabel(jobs[1])).toBe("Shop");
    expect(placeLabel(jobs[3])).toBe("Kevin Berger - Main House");
  });

  it("resolves back to its own job", () => {
    for (const j of jobs) {
      const m = resolvePlace(placeLabel(j), jobs);
      expect(m.kind === "named" && m.job?.id).toBe(j.id);
    }
  });
});
