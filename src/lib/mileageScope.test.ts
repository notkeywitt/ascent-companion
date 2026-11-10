import { describe, expect, it } from "vitest";

import { scopeMileageList, seesAllMileage } from "./mileageScope";

const trips = [
  { TripID: "1", Driver: "Sam Field", "Logged By": "sam@x.com", Miles: 10 },
  { TripID: "2", Driver: "Other Person", "Logged By": "other@x.com", Miles: 5 },
  { TripID: "3", Driver: "Sam Field", "Logged By": "office@x.com", Miles: 2 },
];
const adminReply = { ok: true, isAdmin: true, users: ["Other Person", "Sam Field"], trips };

describe("seesAllMileage", () => {
  it("lets only admin and office see every driver", () => {
    expect(seesAllMileage("admin")).toBe(true);
    expect(seesAllMileage("office")).toBe(true);
    expect(seesAllMileage("lead")).toBe(false);
    expect(seesAllMileage("field")).toBe(false);
    expect(seesAllMileage(undefined)).toBe(false);
  });
});

describe("scopeMileageList", () => {
  it("leaves an office reply alone", () => {
    expect(scopeMileageList(adminReply, { role: "office", email: "o@x.com" })).toBe(adminReply);
  });

  it("narrows a field user Apps Script treated as admin to their own trips", () => {
    const out = scopeMileageList(adminReply, { role: "field", email: "SAM@x.com", myName: "sam field" });
    expect(out.isAdmin).toBe(false);
    expect(out.users).toEqual([]);
    expect(out.trips?.map((t) => t.TripID)).toEqual(["1", "3"]);
  });

  it("matches by Logged By alone when the roster name is unknown", () => {
    const out = scopeMileageList(adminReply, { role: "field", email: "sam@x.com" });
    expect(out.trips?.map((t) => t.TripID)).toEqual(["1"]);
  });

  it("keeps Apps Script's own scoping for a non-admin and hides the driver list", () => {
    const reply = { ok: true, isAdmin: false, users: ["Other Person", "Sam Field"], trips: [trips[2]] };
    const out = scopeMileageList(reply, { role: "field", email: "sam@x.com" });
    expect(out.trips).toEqual([trips[2]]);
    expect(out.users).toEqual([]);
  });
});
