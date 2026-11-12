import { describe, expect, it } from "vitest";
import { hubPath, parseHubPath } from "./hubUrl";
import { billingMonths } from "./billingMonths";

const jobs = [
  { id: "a", name: "Main House", customer: "Kevin Berger" },
  { id: "b", name: "Guest House", customer: "Kevin Berger" },
  { id: "c", name: "Remodel", customer: "Ferron" },
];

describe("hubUrl", () => {
  it("round-trips job, month and bill", () => {
    const ym = billingMonths()[2].value;
    const p = hubPath(jobs[2], jobs, ym, "doc1");
    expect(parseHubPath(p, jobs)).toEqual({ jobId: "c", ym, docId: "doc1" });
  });
  it("uses the full label when a customer has two jobs", () => {
    expect(hubPath(jobs[0], jobs, "")).toBe("/jobs-hub/kevin-berger-main-house");
    expect(parseHubPath("/jobs-hub/Berger", jobs).jobId).toBe("a");
  });
  it("reads a bare month name as the latest one", () => {
    const m = billingMonths()[0];
    expect(parseHubPath(`/jobs-hub/Ferron/${m.label.split(" ")[0]}`, jobs).ym).toBe(m.value);
  });
});
