import { describe, expect, it } from "vitest";

import {
  firstNoticeLink,
  hasNoticeLink,
  noticePlainText,
  parseNoticeBody,
  resolveNoticeHref,
} from "@/lib/noticeLinks";

/**
 * A notice reaches every phone in the company, so the parser has two jobs: turn
 * what the office typed into the link they meant, and never turn anything into
 * a link the browser would run.
 */

const ORIGIN = "https://app.example.com";

describe("resolveNoticeHref", () => {
  it("keeps an app path as an in-app link", () => {
    expect(resolveNoticeHref("/tool-schedule?view=calendar")).toEqual({
      href: "/tool-schedule?view=calendar",
      internal: true,
    });
  });

  it("folds a pasted address on the app's own site back to its path", () => {
    expect(resolveNoticeHref(`${ORIGIN}/vendors?accountId=42#top`, ORIGIN)).toEqual({
      href: "/vendors?accountId=42#top",
      internal: true,
    });
  });

  it("keeps another site's address as an outside link", () => {
    expect(resolveNoticeHref("https://jobtread.com/x", ORIGIN)).toEqual({
      href: "https://jobtread.com/x",
      internal: false,
    });
  });

  it("refuses anything that is not a path or a web address", () => {
    expect(resolveNoticeHref("javascript:alert(1)")).toBeNull();
    expect(resolveNoticeHref("mailto:a@b.com")).toBeNull();
    expect(resolveNoticeHref("//evil.example.com/x")).toBeNull();
    expect(resolveNoticeHref("not a link")).toBeNull();
  });
});

describe("parseNoticeBody", () => {
  it("leaves a message with no link as one text part", () => {
    expect(parseNoticeBody("Time sheets due Friday.")).toEqual([
      { kind: "text", text: "Time sheets due Friday." },
    ]);
  });

  it("reads a labelled link", () => {
    expect(parseNoticeBody("New calendar. [Try it](/employee-time?tab=compare&view=calendar) now")).toEqual([
      { kind: "text", text: "New calendar. " },
      { kind: "link", text: "Try it", href: "/employee-time?tab=compare&view=calendar", internal: true },
      { kind: "text", text: " now" },
    ]);
  });

  it("reads a bare path and leaves the full stop outside it", () => {
    expect(parseNoticeBody("Open /tool-schedule?view=calendar.")).toEqual([
      { kind: "text", text: "Open " },
      { kind: "link", text: "/tool-schedule?view=calendar", href: "/tool-schedule?view=calendar", internal: true },
      { kind: "text", text: "." },
    ]);
  });

  it("reads a pasted app address as an in-app link, shown as typed", () => {
    const parts = parseNoticeBody(`See ${ORIGIN}/bills?docId=9, please`, ORIGIN);
    expect(parts[1]).toEqual({ kind: "link", text: `${ORIGIN}/bills?docId=9`, href: "/bills?docId=9", internal: true });
    expect(parts[2]).toEqual({ kind: "text", text: ", please" });
  });

  it("does not read a fraction or a date as a path", () => {
    expect(hasNoticeLink("Due 11/14, half 1/2 done, and/or later")).toBe(false);
  });

  it("keeps an unsafe labelled link as the text that was typed", () => {
    expect(parseNoticeBody("[click](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[click](javascript:alert(1))" },
    ]);
  });
});

describe("toast helpers", () => {
  it("reads a labelled link as its label", () => {
    expect(noticePlainText("New. [Try it](/tool-schedule?view=calendar)")).toBe("New. Try it");
  });

  it("finds the first link", () => {
    expect(firstNoticeLink("See [a](/a) and [b](/b)")).toEqual({ href: "/a", internal: true });
    expect(firstNoticeLink("No link here")).toBeNull();
  });
});
