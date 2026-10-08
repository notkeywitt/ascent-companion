import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/invoiceReview/types";
import type { PreSendResult } from "@/lib/invoiceReview/preSend";
import {
  clearFinding,
  clearedCount,
  isOpen,
  mergeRun,
  openFindings,
  tally,
  unclearAll,
} from "./preSendMemory";
import { laborFocusHref, readLaborFocus, withoutFocus } from "./findingFocus";

function finding(key: string, severity: "error" | "warning" = "error"): Finding {
  return {
    key,
    kind: "bill-uninvoiced",
    severity,
    title: key,
    detail: "",
    jobId: "J1",
    jobName: "Main House",
    customerName: "Berger",
    invoiceId: "",
    invoiceNumber: "",
  };
}

function run(findings: Finding[], evidenceWarnings: string[] = []): PreSendResult {
  return {
    jobId: "J1",
    jobName: "Main House",
    customerName: "Berger",
    ym: "2026-09",
    monthLabel: "September 2026",
    findings,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    evidenceWarnings,
    empty: false,
  };
}

const keys = (fs: Finding[]) => fs.map((f) => f.key);

describe("a job check's memory", () => {
  it("starts with nothing fixed and nothing cleared", () => {
    const m = mergeRun(null, run([finding("a"), finding("b", "warning")]), "t1");
    expect(keys(openFindings(m))).toEqual(["a", "b"]);
    expect(tally(m)).toEqual({ errors: 1, warnings: 1 });
    expect(m.fixed).toEqual([]);
  });

  it("marks a finding the next run no longer finds as fixed", () => {
    const first = mergeRun(null, run([finding("a"), finding("b")]), "t1");
    const second = mergeRun(first, run([finding("b")]), "t2");
    expect(keys(openFindings(second))).toEqual(["b"]);
    expect(keys(second.fixed)).toEqual(["a"]);
    expect(isOpen(second, "a")).toBe(false);
    expect(isOpen(second, "b")).toBe(true);
  });

  it("re-opens a fixed finding that comes back", () => {
    const first = mergeRun(null, run([finding("a")]), "t1");
    const fixed = mergeRun(first, run([]), "t2");
    const back = mergeRun(fixed, run([finding("a")]), "t3");
    expect(back.fixed).toEqual([]);
    expect(keys(openFindings(back))).toEqual(["a"]);
  });

  // A gate that could not read the job must never render as clean.
  it("never calls a finding fixed on a run that could not read the whole job", () => {
    const first = mergeRun(null, run([finding("a"), finding("b")]), "t1");
    const partial = mergeRun(first, run([finding("b")], ["Drive folder unreadable"]), "t2");
    expect(partial.fixed).toEqual([]);
    expect(keys(openFindings(partial))).toEqual(["b", "a"]);
  });

  it("keeps a cleared finding hidden on every later run", () => {
    const first = mergeRun(null, run([finding("a"), finding("b", "warning")]), "t1");
    const cleared = clearFinding(first, "b");
    expect(keys(openFindings(cleared))).toEqual(["a"]);
    expect(tally(cleared)).toEqual({ errors: 1, warnings: 0 });
    const again = mergeRun(cleared, run([finding("a"), finding("b", "warning")]), "t2");
    expect(keys(openFindings(again))).toEqual(["a"]);
    expect(clearedCount(again)).toBe(1);
    // …and a cleared finding that then disappears is not reported as fixed.
    const gone = mergeRun(again, run([finding("a")]), "t3");
    expect(gone.fixed).toEqual([]);
  });

  it("clears a fixed row off the list", () => {
    const fixed = mergeRun(mergeRun(null, run([finding("a")]), "t1"), run([]), "t2");
    expect(clearFinding(fixed, "a").fixed).toEqual([]);
  });

  it("puts every cleared finding back", () => {
    const m = clearFinding(mergeRun(null, run([finding("a")]), "t1"), "a");
    expect(openFindings(m)).toEqual([]);
    expect(keys(openFindings(unclearAll(m)))).toEqual(["a"]);
  });

  it("leaves a finding the office ruled out of every count", () => {
    const ruled = {
      ...finding("a"),
      suppressedBy: { reason: "", by: "", at: "", scope: "finding" as const },
    };
    const m = mergeRun(null, run([ruled, finding("b")]), "t1");
    expect(keys(openFindings(m))).toEqual(["b"]);
    expect(clearedCount(clearFinding(m, "a"))).toBe(0);
  });
});

describe("a labor finding carried to the board", () => {
  it("round-trips the person, the code and the entries", () => {
    const href = laborFocusHref("J 1", "2026-09", {
      kind: "labor",
      employee: "Ty O'Steen",
      code: "01 31 10",
      entryIds: ["a", "b"],
    });
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("jobId")).toBe("J 1");
    expect(readLaborFocus(q)).toEqual({
      kind: "labor",
      employee: "Ty O'Steen",
      code: "01 31 10",
      entryIds: ["a", "b"],
    });
    expect(withoutFocus(q.toString())).toBe("jobId=J+1&ym=2026-09");
  });

  it("drops the entry list when it would make the link unreasonably long", () => {
    const ids = Array.from({ length: 61 }, (_, i) => `t${i}`);
    const href = laborFocusHref("J1", "2026-09", {
      kind: "labor",
      code: "06 10 00",
      entryIds: ids,
    });
    expect(readLaborFocus(new URLSearchParams(href.split("?")[1]))?.entryIds).toEqual([]);
  });

  it("reads nothing from a board URL without a focus", () => {
    expect(readLaborFocus(new URLSearchParams("jobId=J1&ym=2026-09"))).toBeNull();
  });
});
