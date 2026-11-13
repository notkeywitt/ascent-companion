import { describe, expect, it } from "vitest";
import { rollupRoutes } from "./usage";

describe("rollupRoutes", () => {
  it("groups by view id, counts distinct people, skips non-views", () => {
    const rows = [
      { email: "a@x.com", kind: "view", path: "/bill/1", viewId: "bill" },
      { email: "a@x.com", kind: "view", path: "/bill/2", viewId: "bill" },
      { email: "b@x.com", kind: "view", path: "/bill/3", viewId: "bill" },
      { email: "a@x.com", kind: "view", path: "/odd", viewId: "" },
      { email: "a@x.com", kind: "login", path: "", viewId: "" },
    ];
    expect(rollupRoutes(rows, (id) => id.toUpperCase())).toEqual([
      { key: "bill", label: "BILL", views: 3, users: 2 },
      { key: "/odd", label: "/odd", views: 1, users: 1 },
    ]);
  });
});
