import { describe, expect, it } from "vitest";

import {
  audienceLabel,
  audienceMatches,
  cleanEmails,
  cleanRoles,
  isEveryone,
  isLive,
  joinList,
  noticeStatus,
  parseList,
  windowIsOrdered,
} from "@/lib/notices";

/**
 * The targeting and schedule rules. These are worth a test because both
 * failures are SILENT: a mis-read audience shows a notice to the wrong people
 * (or to everyone), and a mis-read window shows one that should be waiting or
 * finished. Neither throws, so nothing else would catch it.
 */

const EVERYONE = {
  audienceType: "all",
  audienceValue: "",
  audienceRoles: "",
  audienceEmails: "",
};
const TARGETED = (roles: string, emails: string) => ({
  audienceType: "targeted",
  audienceValue: "",
  audienceRoles: roles,
  audienceEmails: emails,
});
const SCHEDULE = (over: Partial<{ active: boolean; startsAt: string; endsAt: string }> = {}) => ({
  active: true,
  startsAt: "",
  endsAt: "",
  ...over,
});

describe("list columns", () => {
  it("trims, drops blanks and de-duplicates", () => {
    expect(parseList(" office , field ,, office ")).toEqual(["office", "field"]);
    expect(parseList("")).toEqual([]);
    expect(parseList(null)).toEqual([]);
    expect(joinList([" a ", "b", "a", ""])).toBe("a,b");
  });

  it("keeps only real roles and email-shaped strings", () => {
    expect(cleanRoles(["office", "nope", "field", "office"])).toEqual(["office", "field"]);
    expect(cleanRoles("office")).toEqual([]);
    expect(cleanEmails([" SAM@x.com ", "not-an-email", "sam@x.com"])).toEqual(["sam@x.com"]);
  });
});

describe("audienceMatches", () => {
  it("reaches everyone when both lists are empty", () => {
    expect(isEveryone(EVERYONE)).toBe(true);
    expect(audienceMatches(EVERYONE, { email: "any@x.com", role: "field" })).toBe(true);
    expect(isEveryone(TARGETED("", ""))).toBe(true);
  });

  it("ORs groups and people", () => {
    const n = TARGETED("office", "lead@x.com");
    expect(audienceMatches(n, { email: "someone@x.com", role: "office" })).toBe(true);
    expect(audienceMatches(n, { email: "lead@x.com", role: "field" })).toBe(true);
    expect(audienceMatches(n, { email: "other@x.com", role: "field" })).toBe(false);
  });

  it("matches a person case-insensitively", () => {
    const n = TARGETED("", "sam@x.com");
    expect(audienceMatches(n, { email: "SAM@x.com", role: "field" })).toBe(true);
  });

  it("still honours the legacy single-target columns", () => {
    const role = { audienceType: "role", audienceValue: "lead", audienceRoles: "", audienceEmails: "" };
    expect(audienceMatches(role, { email: "a@x.com", role: "lead" })).toBe(true);
    expect(audienceMatches(role, { email: "a@x.com", role: "field" })).toBe(false);
    const user = { audienceType: "user", audienceValue: "Sam@x.com", audienceRoles: "", audienceEmails: "" };
    expect(audienceMatches(user, { email: "sam@x.com", role: "field" })).toBe(true);
    expect(audienceMatches(user, { email: "jo@x.com", role: "field" })).toBe(false);
  });

  it("never broadcasts a legacy row whose value went missing", () => {
    const broken = { audienceType: "user", audienceValue: "", audienceRoles: "", audienceEmails: "" };
    expect(isEveryone(broken)).toBe(false);
    expect(audienceMatches(broken, { email: "a@x.com", role: "admin" })).toBe(false);
  });
});

describe("noticeStatus", () => {
  const now = Date.parse("2026-09-07T12:00:00Z");

  it("is live with no window at all", () => {
    expect(noticeStatus(SCHEDULE(), now)).toBe("live");
    expect(isLive(SCHEDULE(), now)).toBe(true);
  });

  it("waits until the start time", () => {
    expect(noticeStatus(SCHEDULE({ startsAt: "2026-09-07T18:00:00Z" }), now)).toBe("scheduled");
    expect(noticeStatus(SCHEDULE({ startsAt: "2026-09-07T06:00:00Z" }), now)).toBe("live");
  });

  it("stops at the end time", () => {
    expect(noticeStatus(SCHEDULE({ endsAt: "2026-09-07T06:00:00Z" }), now)).toBe("ended");
    expect(noticeStatus(SCHEDULE({ endsAt: "2026-09-08T06:00:00Z" }), now)).toBe("live");
  });

  it("reads switched-off before any window", () => {
    expect(noticeStatus(SCHEDULE({ active: false, startsAt: "2026-09-01T00:00:00Z" }), now)).toBe("off");
  });

  it("ignores an unparseable stamp rather than hiding the notice", () => {
    expect(noticeStatus(SCHEDULE({ startsAt: "whenever" }), now)).toBe("live");
  });

  it("rejects a window that ends before it starts", () => {
    expect(windowIsOrdered("2026-09-07T12:00:00Z", "2026-09-07T08:00:00Z")).toBe(false);
    expect(windowIsOrdered("2026-09-07T12:00:00Z", "2026-09-07T18:00:00Z")).toBe(true);
    expect(windowIsOrdered("", "2026-09-07T08:00:00Z")).toBe(true);
  });
});

describe("audienceLabel", () => {
  it("names the mix", () => {
    expect(audienceLabel(EVERYONE)).toBe("Everyone");
    expect(audienceLabel(TARGETED("office,field", ""))).toBe("Office, Field");
    expect(audienceLabel(TARGETED("", "a@x.com"))).toBe("1 person");
    expect(audienceLabel(TARGETED("lead", "a@x.com,b@x.com"))).toBe("Leads · 2 people");
  });
});
