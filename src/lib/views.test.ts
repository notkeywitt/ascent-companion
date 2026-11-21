import { describe, expect, it } from "vitest";
import { ROLE_VIEWS, viewIdForPath } from "./views";

const reaches = (role: keyof typeof ROLE_VIEWS, path: string) => {
  const id = viewIdForPath(path);
  return id === null || ROLE_VIEWS[role].includes(id);
};

describe("field and the Jobs page (owner, 2026-11-21: no dollars)", () => {
  it("lets field open the Jobs page and its money-free reads", () => {
    for (const p of [
      "/jobs-hub",
      "/api/jobs-hub/cards",
      "/api/jobs/files",
      "/api/notes",
      "/api/home/gantt",
      "/api/punch-list",
    ])
      expect(reaches("field", p), p).toBe(true);
  });

  it("keeps every money route the Jobs page calls away from field", () => {
    for (const p of [
      "/api/jobs-hub/ribbon",
      "/api/jobs-hub/scan-bills",
      "/api/notes/month-bills",
      "/api/job-board",
      "/api/jobs/to-be-invoiced",
      "/api/trackingsheet/month-donuts",
      "/api/home/board",
      "/api/schedule",
    ])
      expect(reaches("field", p), p).toBe(false);
    for (const id of ["recode", "job-board", "jobs", "tracking-sheet", "invoicing-summary", "home"])
      expect(ROLE_VIEWS.field, id).not.toContain(id);
  });

  it("leaves the money routes open to a lead, as before", () => {
    for (const p of ["/api/jobs-hub/ribbon", "/api/jobs-hub/scan-bills", "/api/notes/month-bills", "/api/job-board"])
      expect(reaches("lead", p), p).toBe(true);
  });
});
