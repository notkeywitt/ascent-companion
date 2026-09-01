/**
 * How wide a ruling reaches.
 *
 * This is the only mechanism in the review that makes a real finding stop being
 * shown, so its blast radius is worth pinning precisely. The failure that
 * matters is a ruling reaching PAST what the office meant — that is how a
 * genuine problem gets silenced years later by a note nobody remembers writing.
 *
 * `applyRulings` is pure, so it is tested directly; the storage half needs a
 * database and is exercised through the route.
 */
import { describe, expect, it } from "vitest";

import { applyRulings, type Ruling } from "./rulings";
import { customerKindKey, findingKey, jobKindKey, type Finding } from "./types";

function finding(partial: Partial<Finding> = {}): Finding {
  const kind = partial.kind ?? "backup-missing";
  const jobId = partial.jobId ?? "J1";
  return {
    key: findingKey(kind, jobId, partial.invoiceId ?? "b1"),
    kind,
    severity: "error",
    title: "No backup filed",
    detail: "",
    jobId,
    jobName: "Otis Perkins Addition",
    customerName: "Ferron",
    invoiceId: "",
    invoiceNumber: "",
    ...partial,
  };
}

function ruling(partial: Partial<Ruling> & { key: string }): Ruling {
  return {
    kind: "backup-missing",
    jobId: "J1",
    scope: "finding",
    reason: "Their allowance draws never have vendor backup.",
    createdBy: "office@ascentbuildingco.com",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

const suppressed = (fs: Finding[], rs: Ruling[]) =>
  applyRulings(fs, rs).map((f) => Boolean(f.suppressedBy));

describe("a 'finding' ruling", () => {
  const f = finding();

  it("suppresses exactly the finding it was written about", () => {
    expect(suppressed([f], [ruling({ key: f.key })])).toEqual([true]);
  });

  it("does not reach a sibling finding of the same kind on the same job", () => {
    const other = finding({ invoiceId: "b2" });
    expect(suppressed([other], [ruling({ key: f.key })])).toEqual([false]);
  });
});

describe("a 'job-kind' ruling", () => {
  const r = ruling({ key: jobKindKey("backup-missing", "J1"), scope: "job-kind" });

  it("covers every finding of that kind on that job", () => {
    const fs = [finding({ invoiceId: "b1" }), finding({ invoiceId: "b2" })];
    expect(suppressed(fs, [r])).toEqual([true, true]);
  });

  it("does not reach another KIND on the same job", () => {
    expect(suppressed([finding({ kind: "backup-unmatched" })], [r])).toEqual([false]);
  });

  it("does not reach the same kind on ANOTHER job of the same customer", () => {
    // The distinction that makes customer-kind worth having: this is a
    // different job, so a job-scoped ruling must not touch it.
    expect(suppressed([finding({ jobId: "J2" })], [r])).toEqual([false]);
  });
});

describe("a 'customer-kind' ruling", () => {
  const r = ruling({
    key: customerKindKey("backup-missing", "Ferron"),
    scope: "customer-kind",
  });

  it("covers that kind across every job of that customer", () => {
    const fs = [finding({ jobId: "J1" }), finding({ jobId: "J2" }), finding({ jobId: "J3" })];
    expect(suppressed(fs, [r])).toEqual([true, true, true]);
  });

  it("covers a job that did not exist when the ruling was written", () => {
    // The whole point of the scope — a standing arrangement is a property of
    // the client, so it should already apply to their next job.
    expect(suppressed([finding({ jobId: "J-new-next-year" })], [r])).toEqual([true]);
  });

  it("does not reach another CUSTOMER", () => {
    expect(suppressed([finding({ customerName: "Okonkwo" })], [r])).toEqual([false]);
  });

  it("does not reach another kind for the same customer", () => {
    expect(suppressed([finding({ kind: "math-tax" })], [r])).toEqual([false]);
  });

  it("ignores casing and stray spacing in the customer name", () => {
    expect(suppressed([finding({ customerName: "  FERRON " })], [r])).toEqual([true]);
  });
});

describe("what a suppressed finding carries", () => {
  it("keeps the office's own words and who wrote them", () => {
    const f = finding();
    const r = ruling({ key: f.key, reason: "Deposit draw — never has backup." });
    const note = applyRulings([f], [r])[0].suppressedBy;
    expect(note?.reason).toBe("Deposit draw — never has backup.");
    expect(note?.by).toBe("office@ascentbuildingco.com");
    expect(note?.scope).toBe("finding");
  });

  it("prefers the NARROWEST ruling when several could apply", () => {
    // So the note the office reads back is the most specific thing they
    // actually wrote about this finding, not the blanket one.
    const f = finding();
    const notes = applyRulings(
      [f],
      [
        ruling({ key: customerKindKey("backup-missing", "Ferron"), scope: "customer-kind", reason: "customer-wide" }),
        ruling({ key: jobKindKey("backup-missing", "J1"), scope: "job-kind", reason: "job-wide" }),
        ruling({ key: f.key, reason: "this one" }),
      ],
    );
    expect(notes[0].suppressedBy?.reason).toBe("this one");
  });

  it("leaves the input untouched, so raw check output stays inspectable", () => {
    const f = finding();
    applyRulings([f], [ruling({ key: f.key })]);
    expect(f.suppressedBy).toBeUndefined();
  });
});
