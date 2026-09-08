import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  contactLine,
  daysSince,
  fmtDate,
  leadAddress,
  leadScope,
  sortLeadCards,
  toLeadCard,
  type LeadLike,
} from "./leadBoard";

// Every expectation here is measured from today, so pin the clock.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

const lead = (over: Partial<LeadLike> & { id: string }): LeadLike => ({
  name: over.id,
  address: "",
  createdAt: "2026-09-01T00:00:00.000Z",
  local: false,
  inquiry: null,
  ...over,
  tracking: {
    stage: "new",
    nextAction: "",
    nextActionDate: "",
    lastContactDate: "",
    estValue: "",
    projectScope: "",
    notes: "",
    updatedAt: "",
    ...over.tracking,
  },
});

describe("daysSince", () => {
  it("compares midnight to midnight, so a timestamp isn't a day young", () => {
    expect(daysSince("2026-09-01T17:22:00.000Z")).toBe(7);
    expect(daysSince("2026-09-01")).toBe(7);
  });
  it("is null for nothing and for gibberish", () => {
    expect(daysSince("")).toBeNull();
    expect(daysSince("soon")).toBeNull();
  });
});

describe("fmtDate", () => {
  it("reads a plain day in UTC, so it never slips a day back", () => {
    expect(fmtDate("2026-09-08")).toBe("Sep 8, 2026");
  });
  it("shows an em dash for nothing", () => {
    expect(fmtDate("")).toBe("—");
  });
});

describe("leadScope", () => {
  it("prefers the scope we wrote to the answer they typed", () => {
    const l = lead({
      id: "a",
      tracking: { projectScope: "Re-side + rebuild deck" } as LeadLike["tracking"],
      inquiry: { projectDetails: "new siding maybe?", address: "" },
    });
    expect(leadScope(l)).toBe("Re-side + rebuild deck");
  });
  it("falls back to the website answer, and never to our working notes", () => {
    const l = lead({
      id: "a",
      tracking: { notes: "seems price-sensitive" } as LeadLike["tracking"],
      inquiry: { projectDetails: "new siding maybe?", address: "" },
    });
    expect(leadScope(l)).toBe("new siding maybe?");
    expect(leadScope(lead({ id: "b", tracking: { notes: "x" } as LeadLike["tracking"] }))).toBe("");
  });
});

describe("leadAddress", () => {
  it("falls back to the address they gave the website form", () => {
    expect(
      leadAddress(lead({ id: "a", inquiry: { projectDetails: "", address: "12 Roche Harbor Rd" } })),
    ).toBe("12 Roche Harbor Rd");
  });
});

describe("toLeadCard", () => {
  it("measures quiet days from the last touch when there is one", () => {
    const c = toLeadCard(
      lead({ id: "a", tracking: { lastContactDate: "2026-09-04" } as LeadLike["tracking"] }),
    );
    expect(c.quietDays).toBe(4);
    expect(c.neverContacted).toBe(false);
  });
  it("measures from arrival when nothing has ever been logged", () => {
    const c = toLeadCard(lead({ id: "a" }));
    expect(c.quietDays).toBe(7);
    expect(c.neverContacted).toBe(true);
  });
});

describe("sortLeadCards", () => {
  const cards = [
    lead({ id: "fresh", tracking: { lastContactDate: "2026-09-07" } as LeadLike["tracking"] }),
    lead({ id: "old", tracking: { lastContactDate: "2026-08-01" } as LeadLike["tracking"] }),
    lead({ id: "middle", tracking: { lastContactDate: "2026-09-01" } as LeadLike["tracking"] }),
  ].map(toLeadCard);

  it("puts the longest-quiet lead first by default", () => {
    expect(sortLeadCards(cards, "quiet").map((c) => c.id)).toEqual(["old", "middle", "fresh"]);
  });
  it("flips to the most recently contacted", () => {
    expect(sortLeadCards(cards, "recent").map((c) => c.id)).toEqual(["fresh", "middle", "old"]);
  });
  it("orders a never-contacted lead by when it arrived, not as if it were fresh", () => {
    const never = toLeadCard(lead({ id: "never", createdAt: "2026-07-01T00:00:00.000Z" }));
    expect(sortLeadCards([...cards, never], "quiet")[0].id).toBe("never");
  });
  it("sends a lead with no usable date to the end, either way", () => {
    const undated = toLeadCard(lead({ id: "undated", createdAt: "" }));
    expect(sortLeadCards([undated, ...cards], "quiet").at(-1)?.id).toBe("undated");
    expect(sortLeadCards([undated, ...cards], "recent").at(-1)?.id).toBe("undated");
  });
});

describe("contactLine", () => {
  it("gives the date and how long ago it was", () => {
    const c = toLeadCard(
      lead({ id: "a", tracking: { lastContactDate: "2026-09-07" } as LeadLike["tracking"] }),
    );
    expect(contactLine(c)).toBe("Sep 7, 2026 · 1 day ago");
  });
  it("says plainly when nothing has been logged, and how long that has been", () => {
    expect(contactLine(toLeadCard(lead({ id: "a" })))).toBe(
      "No contact logged · 7 days since it arrived",
    );
    expect(contactLine(toLeadCard(lead({ id: "a", createdAt: "" })))).toBe("No contact logged");
  });
});
