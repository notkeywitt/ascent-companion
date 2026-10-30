import { beforeEach, describe, expect, it } from "vitest";
import { countNewRequisitions, markRequisitionsSeen } from "./requisitionsSeen";

const row = (ReqID: string, Status = "Requested") => ({ ReqID, Status });

describe("requisitionsSeen", () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    } as Storage;
  });

  it("counts every open request as new before the first visit", () => {
    expect(countNewRequisitions([row("REQ-20261029-090000"), row("REQ-20261028-090000", "Ordered")])).toBe(1);
  });

  it("counts only open requests after the newest one seen", () => {
    markRequisitionsSeen([row("REQ-20261029-090000")]);
    const rows = [row("REQ-20261030-080000"), row("REQ-20261029-090000"), row("REQ-20261030-081500", "Denied")];
    expect(countNewRequisitions(rows)).toBe(1);
  });

  it("never moves the line back on a filtered list", () => {
    markRequisitionsSeen([row("REQ-20261030-080000")]);
    markRequisitionsSeen([row("REQ-20261001-080000")]);
    expect(countNewRequisitions([row("REQ-20261030-080000")])).toBe(0);
  });
});
