import { describe, expect, it } from "vitest";

import {
  buildChangeList,
  pageRoutesFrom,
  parseNumstatLog,
  routeForFile,
  topPageSince,
} from "./buildChanges.mjs";

const routes = pageRoutesFrom([
  "page.tsx",
  "payments/page.tsx",
  "admin/page.tsx",
  "admin/copy/page.tsx",
  "(shell)/jobs/page.tsx",
  "bill/[docId]/page.tsx",
]);

describe("pageRoutesFrom", () => {
  it("drops route groups and dynamic pages", () => {
    expect([...routes].sort()).toEqual(["/", "/admin", "/admin/copy", "/jobs", "/payments"]);
  });
});

describe("routeForFile", () => {
  it("maps a page folder file to its route", () => {
    expect(routeForFile("src/app/payments/PaymentsClient.tsx", routes)).toBe("/payments");
    expect(routeForFile("src/app/admin/copy/page.tsx", routes)).toBe("/admin/copy");
  });
  it("maps an api route to its page, climbing to the nearest page", () => {
    expect(routeForFile("src/app/api/payments/route.ts", routes)).toBe("/payments");
    expect(routeForFile("src/app/api/admin/build/route.ts", routes)).toBe("/admin");
  });
  it("stops at a dynamic folder", () => {
    expect(routeForFile("src/app/bill/[docId]/BillView.tsx", routes)).toBeNull();
  });
  it("maps the root page, but not layout or an api route with no page", () => {
    expect(routeForFile("src/app/page.tsx", routes)).toBe("/");
    expect(routeForFile("src/app/layout.tsx", routes)).toBeNull();
    expect(routeForFile("src/app/api/version/route.ts", routes)).toBeNull();
  });
  it("ignores files outside src/app", () => {
    expect(routeForFile("src/components/HomeMasthead.tsx", routes)).toBeNull();
  });
});

const LOG = [
  "@ccc",
  "10\t2\tsrc/app/payments/Client.tsx",
  "1\t1\tsrc/app/admin/page.tsx",
  "",
  "@bbb",
  "3\t0\tsrc/app/admin/copy/page.tsx",
  "-\t-\tsrc/app/payments/logo.png",
  "",
  "@aaa",
  "99\t0\tsrc/app/jobs/page.tsx",
].join("\n");

describe("parseNumstatLog / buildChangeList", () => {
  it("reads commits and counts a binary file as 1", () => {
    const c = parseNumstatLog(LOG);
    expect(c.map((x) => x.sha)).toEqual(["ccc", "bbb", "aaa"]);
    expect(c[1].files).toEqual([
      ["src/app/admin/copy/page.tsx", 3],
      ["src/app/payments/logo.png", 1],
    ]);
  });
  it("sums lines per page per commit", () => {
    expect(buildChangeList(LOG, routes)[0]).toEqual({ sha: "ccc", pages: { "/payments": 12, "/admin": 2 } });
  });
});

describe("topPageSince", () => {
  const list = buildChangeList(LOG, routes);
  it("names the page with the most edits newer than the tab's build", () => {
    expect(topPageSince(list, "aaa")).toBe("/payments"); // ccc+bbb: payments 13, admin 2, copy 3
  });
  it("uses only the newer commits", () => {
    expect(topPageSince(list, "bbb")).toBe("/payments"); // ccc only
  });
  it("is null when the tab is current, unknown, or nothing page-shaped changed", () => {
    expect(topPageSince(list, "ccc")).toBeNull();
    expect(topPageSince(list, "zzz")).toBeNull();
    expect(topPageSince([{ sha: "n", pages: {} }, { sha: "o", pages: {} }], "o")).toBeNull();
    expect(topPageSince(null, "o")).toBeNull();
  });
});
