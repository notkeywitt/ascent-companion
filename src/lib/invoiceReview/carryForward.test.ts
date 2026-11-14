import { describe, expect, it } from "vitest";

import { buildFindingPrompt, needsVerdict } from "./brief";
import { attachDispositions } from "./dispositions";
import { findingPrint, type Finding } from "./types";

const f: Finding = {
  jobId: "job1",
  jobName: "Bunkhouse",
  customerName: "Berger",
  invoiceId: "",
  invoiceNumber: "",
  key: "bill-duplicate-cross-job|job1|x",
  kind: "bill-duplicate-cross-job",
  severity: "error",
  title: "Two bills look the same",
  detail: "Counter Culture $35.00 twice.",
  amount: 35,
  sourceLink: "/bill/b1?jobId=job1",
};
const verdict = { verdict: "confirmed" as const, why: "w", suggestedAction: "", model: "m", at: "2026-11-13T00:00:00Z" };

describe("verdict carry-forward", () => {
  it("keeps a verdict while the finding is unchanged", () => {
    const [out] = attachDispositions([f], new Map([[f.key, { ...verdict, seen: findingPrint(f) }]]));
    expect(out.disposition?.stale).toBeUndefined();
    expect(needsVerdict(out)).toBe(false);
  });

  it("marks a verdict stale when the amount moves", () => {
    const [out] = attachDispositions([{ ...f, amount: 70 }], new Map([[f.key, { ...verdict, seen: findingPrint(f) }]]));
    expect(out.disposition?.stale).toBe(true);
    expect(needsVerdict(out)).toBe(true);
  });

  it("carries a verdict written before the fingerprint existed", () => {
    const [out] = attachDispositions([f], new Map([[f.key, { ...verdict, seen: "" }]]));
    expect(needsVerdict(out)).toBe(false);
  });
});

describe("buildFindingPrompt", () => {
  it("carries the ids and links Claude needs", () => {
    const p = buildFindingPrompt(f, "2026-10");
    expect(p).toContain("`bill-duplicate-cross-job|job1|x`");
    expect(p).toContain("https://ascent-companion.vercel.app/bill/b1?jobId=job1");
    expect(p).toContain("https://app.jobtread.com/jobs/job1");
    expect(p).not.toContain("null");
  });
});
