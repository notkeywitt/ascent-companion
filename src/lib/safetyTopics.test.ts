import { describe, expect, it } from "vitest";

import {
  SAFETY_CATEGORIES,
  SAFETY_TOPICS,
  findSafetyTopic,
  searchSafetyTopics,
  seasonOf,
  topicsInSeason,
} from "./safetyTopics";

/**
 * The catalog is 70-odd hand-written entries, so the risk is a copy-paste slip:
 * a duplicated id after cloning a row, an empty points array, a title that no
 * longer round-trips through the picker. These are the checks a human reviewer
 * would not reliably catch by reading.
 */
describe("safety topic catalog", () => {
  it("holds enough topics to run weekly meetings for over a year", () => {
    expect(SAFETY_TOPICS.length).toBeGreaterThan(52);
  });

  it("has no duplicate ids", () => {
    const ids = SAFETY_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate titles", () => {
    // Titles are the sheet value, the Drive folder name and the picker's key.
    const titles = SAFETY_TOPICS.map((t) => t.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives every topic a usable script", () => {
    for (const t of SAFETY_TOPICS) {
      expect(t.points.length, t.id).toBeGreaterThanOrEqual(4);
      expect(t.points.every((p) => p.trim().length > 0), t.id).toBe(true);
    }
  });

  it("uses only declared categories", () => {
    for (const t of SAFETY_TOPICS) {
      expect(SAFETY_CATEGORIES, t.id).toContain(t.category);
    }
  });

  it("fills every category, so no filter chip is a dead end", () => {
    for (const c of SAFETY_CATEGORIES) {
      expect(SAFETY_TOPICS.filter((t) => t.category === c).length, c).toBeGreaterThan(0);
    }
  });

  it("has in-season topics whatever the month", () => {
    for (let m = 0; m < 12; m++) {
      const season = seasonOf(new Date(2026, m, 15));
      expect(topicsInSeason(season).length, `month ${m}`).toBeGreaterThan(0);
    }
  });

  it("points every source and rule link at a real URL", () => {
    for (const t of SAFETY_TOPICS) {
      if (t.source) expect(t.source.url, t.id).toMatch(/^https:\/\//);
    }
  });
});

describe("findSafetyTopic", () => {
  it("round-trips every title, so a picked topic keeps its talking points", () => {
    for (const t of SAFETY_TOPICS) {
      expect(findSafetyTopic(t.title)?.id, t.id).toBe(t.id);
    }
  });

  it("ignores case and surrounding space", () => {
    expect(findSafetyTopic("  NAIL GUN SAFETY ")?.id).toBe("nail-guns");
  });

  it("returns nothing for a topic the crew typed themselves", () => {
    expect(findSafetyTopic("Whatever came up this week")).toBeUndefined();
  });
});

describe("searchSafetyTopics", () => {
  it("returns everything for an empty query", () => {
    expect(searchSafetyTopics("   ")).toHaveLength(SAFETY_TOPICS.length);
  });

  it("matches on the talking points, not just the title", () => {
    expect(searchSafetyTopics("811").map((t) => t.id)).toContain("buried-utilities");
  });

  it("narrows as terms are added rather than widening", () => {
    const one = searchSafetyTopics("ladder");
    const two = searchSafetyTopics("ladder wet");
    expect(two.length).toBeLessThan(one.length);
  });
});

describe("seasonOf", () => {
  it("maps months to the local weather seasons", () => {
    expect(seasonOf(new Date(2026, 0, 15))).toBe("winter");
    expect(seasonOf(new Date(2026, 3, 15))).toBe("spring");
    expect(seasonOf(new Date(2026, 6, 15))).toBe("summer");
    expect(seasonOf(new Date(2026, 9, 15))).toBe("fall");
    expect(seasonOf(new Date(2026, 11, 15))).toBe("winter");
  });
});
