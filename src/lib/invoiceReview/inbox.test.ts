import { describe, expect, it } from "vitest";

import { inboxRow, unreadParts } from "./inbox";
import type { Finding, MonthEvidence } from "./types";

const month = (over: Partial<MonthEvidence>) =>
  ({ emailChecked: true, mailTruncated: false, laborRates: new Map(), ...over }) as MonthEvidence;

describe("what a partial read leaves alone", () => {
  it("keeps nothing when every read worked", () => {
    expect(unreadParts(month({}))).toEqual({ kinds: [], subjects: [] });
  });

  it("keeps each failed source's kinds and each failed job, and nothing more", () => {
    const keep = unreadParts(
      month({ emailChecked: false, laborRates: null, sheetsUnread: true, unreadJobIds: ["j2"], failedKinds: ["math-line"] }),
    );
    expect(keep.kinds).toEqual(expect.arrayContaining(["email-unknown-sender", "labor-rate-stale", "sheet-tracking-tab-off", "math-line"]));
    expect(keep.kinds).not.toContain("bill-uninvoiced");
    expect(keep.subjects).toEqual(["j2"]);
  });

  it("keeps the mail kinds when the sweep was cut short", () => {
    expect(unreadParts(month({ mailTruncated: true })).kinds).toContain("email-bill-missed");
  });
});

describe("the inbox row's link and target", () => {
  const f = (over: Partial<Finding>): Finding =>
    ({ key: "k", kind: "qbo-never-approved", severity: "error", title: "T", detail: "", jobId: "j1", jobName: "Job", customerName: "", invoiceId: "", invoiceNumber: "", ...over }) as Finding;

  it("opens the bill on the job's board and carries its id", () => {
    const row = inboxRow(f({ target: { kind: "bill", billId: "b9" }, sourceLink: "https://x" }), "2026-10");
    expect(row.link).toBe("/jobs-hub?jobId=j1&ym=2026-10&bill=b9");
    expect(row.fixAction).toBe("approve-bill:b9");
    expect(inboxRow(f({ kind: "bill-uninvoiced", target: { kind: "bill", billId: "b9" } }), "2026-10").fixAction).toBe("bill:b9");
    expect(row.key).toBe("k");
    expect(row.subject).toBe("j1");
  });

  it("uses the finding's own page, else the hub, else the month", () => {
    expect(inboxRow(f({ sourceLink: "https://mail/t1" }), "2026-10").link).toBe("https://mail/t1");
    expect(inboxRow(f({}), "2026-10").link).toBe("/jobs-hub?jobId=j1&ym=2026-10");
    expect(inboxRow(f({ jobId: "" }), "2026-10").link).toBe("/invoice-review?ym=2026-10");
    expect(inboxRow(f({}), "2026-10").fixAction).toBe("");
  });

  it("sends a pre-send row to the hub, where the check runs again", () => {
    expect(inboxRow(f({ sourceLink: "https://drive/pdf" }), "2026-10", true).link).toBe("/jobs-hub?jobId=j1&ym=2026-10");
  });
});
