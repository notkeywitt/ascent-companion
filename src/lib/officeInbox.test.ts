import { describe, expect, it } from "vitest";
import { INBOX_QUERIES, mergeInbox, senderName } from "./officeInbox";

describe("senderName", () => {
  it("takes the display name", () => {
    expect(senderName('"Jane Doe" <jane@x.com>')).toBe("Jane Doe");
    expect(senderName("Sunset Supply <ar@sunset.com>")).toBe("Sunset Supply");
  });
  it("falls back to the address", () => {
    expect(senderName("<jane@x.com>")).toBe("jane@x.com");
    expect(senderName("jane@x.com")).toBe("jane@x.com");
  });
});

describe("INBOX_QUERIES", () => {
  it("never overlap", () => {
    expect(INBOX_QUERIES.office).toContain("-label:Keillor");
    expect(INBOX_QUERIES.keillor).toBe("label:Keillor");
  });
});

describe("mergeInbox", () => {
  it("merges newest first, tags the source, and drops a duplicate", () => {
    const rows = mergeInbox({
      office: [
        { threadId: "a", subject: "Old", from: "A <a@x>", date: "2026-11-20T10:00:00Z" },
        { threadId: "b", subject: "", from: "b@x", date: "2026-11-22T10:00:00Z", attachments: ["q.pdf"] },
      ],
      keillor: [
        { threadId: "c", subject: "Mine", from: "C <c@x>", date: "2026-11-21T10:00:00Z", messages: 3 },
        { threadId: "a", subject: "Old", from: "A <a@x>", date: "2026-11-20T10:00:00Z" },
        { subject: "no id" },
      ],
    });
    expect(rows.map((r) => r.threadId)).toEqual(["b", "c", "a"]);
    expect(rows[0]).toMatchObject({ subject: "(no subject)", sender: "b@x", attachments: 1, source: "office" });
    expect(rows[1]).toMatchObject({ source: "keillor", messages: 3 });
    expect(rows[2].source).toBe("keillor");
  });
});
