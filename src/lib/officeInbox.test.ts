import { describe, expect, it } from "vitest";
import {
  INBOX_QUERIES,
  isAppleTouch,
  isTagKind,
  mergeInbox,
  isPdfAttachment,
  senderName,
  tagNeedsJob,
} from "./officeInbox";

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

describe("tag kinds", () => {
  it("know which kinds name a job", () => {
    expect(isTagKind("todo")).toBe(true);
    expect(isTagKind("invoice")).toBe(false);
    expect(isTagKind("delete")).toBe(false);
    expect(tagNeedsJob("todo")).toBe(true);
    expect(tagNeedsJob("processed")).toBe(true);
    expect(tagNeedsJob("ai-todo")).toBe(false);
    expect(tagNeedsJob("not-invoice")).toBe(false);
  });
});

describe("isPdfAttachment", () => {
  it("takes a PDF by type or name, with an id", () => {
    expect(isPdfAttachment({ name: "inv.pdf", type: "application/octet-stream", attachmentId: "18c2ab:0" })).toBe(true);
    expect(isPdfAttachment({ name: "quote", type: "application/pdf", attachmentId: "18c2ab:2" })).toBe(true);
    expect(isPdfAttachment({ name: "photo.jpg", type: "image/jpeg", attachmentId: "18c2ab:1" })).toBe(false);
    expect(isPdfAttachment({ name: "inv.pdf", type: "application/pdf" })).toBe(false);
  });
});

describe("isAppleTouch", () => {
  it("knows an iPhone and an iPad, not a Mac or Android", () => {
    expect(isAppleTouch("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(true);
    expect(isAppleTouch("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isAppleTouch("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isAppleTouch("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe(false);
  });
});
