import { describe, expect, it } from "vitest";

import { mergeToasted, planToasts } from "@/lib/noticeToasts";

/**
 * The desktop-toast rule. Both failure modes are annoying rather than loud,
 * which is why they need a test: toasting a notice the reader already read, or
 * toasting the same one on every reload.
 */

describe("planToasts", () => {
  const base = { feed: [3, 2, 1], toasted: [], hidden: true, enabled: true };

  it("toasts what is new when the app is in the background", () => {
    expect(planToasts(base).toast).toEqual([3, 2, 1]);
  });

  it("says nothing while the reader is looking at the app", () => {
    // The banner under the header is already showing it.
    expect(planToasts({ ...base, hidden: false }).toast).toEqual([]);
  });

  it("says nothing when the device has alerts off", () => {
    expect(planToasts({ ...base, enabled: false }).toast).toEqual([]);
  });

  it("only toasts a notice once per device", () => {
    expect(planToasts({ ...base, toasted: [2, 1] }).toast).toEqual([3]);
    expect(planToasts({ ...base, toasted: [3, 2, 1] }).toast).toEqual([]);
  });

  it("caps a burst", () => {
    expect(planToasts({ ...base, feed: [9, 8, 7, 6, 5] }).toast).toEqual([9, 8, 7]);
    expect(planToasts({ ...base, feed: [9, 8, 7, 6, 5], cap: 1 }).toast).toEqual([9]);
  });

  it("records everything the feed returned, toasted or not", () => {
    // A notice met as a banner (visible) must never toast later.
    const visible = planToasts({ ...base, hidden: false });
    expect(visible.toast).toEqual([]);
    expect(visible.ledger).toEqual([3, 2, 1]);
    expect(planToasts({ ...base, toasted: visible.ledger }).toast).toEqual([]);
  });

  it("keeps the ledger from growing without end", () => {
    const ledger = planToasts({ ...base, feed: [4], toasted: [1, 2, 3], ledgerCap: 3 }).ledger;
    expect(ledger).toEqual([2, 3, 4]);
  });
});

describe("mergeToasted", () => {
  it("de-duplicates and keeps the newest at the end", () => {
    expect(mergeToasted([1, 2, 3], [2, 4])).toEqual([1, 3, 2, 4]);
  });

  it("is a no-op for ids it already holds", () => {
    expect(mergeToasted([1, 2], [1, 2])).toEqual([1, 2]);
  });

  it("survives an empty ledger and an empty round", () => {
    expect(mergeToasted([], [1])).toEqual([1]);
    expect(mergeToasted([1], [])).toEqual([1]);
  });
});
