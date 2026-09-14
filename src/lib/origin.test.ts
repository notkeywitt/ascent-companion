import { describe, expect, it } from "vitest";

import { allowedOrigins, isSameSiteRequest, isStateChanging } from "./origin";

const HOST = "ascent-companion.vercel.app";
const SELF = `https://${HOST}`;

describe("isStateChanging", () => {
  it("treats reads as safe", () => {
    for (const m of ["GET", "get", "HEAD", "OPTIONS"]) {
      expect(isStateChanging(m)).toBe(false);
    }
  });

  it("treats anything that can write as state-changing", () => {
    for (const m of ["POST", "post", "PUT", "PATCH", "DELETE"]) {
      expect(isStateChanging(m)).toBe(true);
    }
  });

  it("treats a missing method as state-changing", () => {
    // Fail closed: an unknown method gets the check, not a free pass.
    expect(isStateChanging(undefined)).toBe(true);
    expect(isStateChanging("")).toBe(true);
  });
});

describe("allowedOrigins", () => {
  it("allows this host over https, and not over http", () => {
    const set = allowedOrigins(HOST);
    expect(set.has(SELF)).toBe(true);
    expect(set.has(`http://${HOST}`)).toBe(false);
  });

  it("allows http for a loopback host, so npm run dev works", () => {
    expect(allowedOrigins("localhost:3000").has("http://localhost:3000")).toBe(true);
    expect(allowedOrigins("127.0.0.1:3000").has("http://127.0.0.1:3000")).toBe(true);
  });

  it("adds extra origins from the env list, trimming and lowercasing", () => {
    const set = allowedOrigins(HOST, " https://Assistant.Ascentbuildingco.com/ , ");
    expect(set.has("https://assistant.ascentbuildingco.com")).toBe(true);
    expect(set.has(SELF)).toBe(true);
  });

  it("is empty when there is no host and no extras", () => {
    expect(allowedOrigins(null).size).toBe(0);
  });
});

describe("isSameSiteRequest", () => {
  it("lets every read through, whatever the origin", () => {
    expect(isSameSiteRequest("GET", "https://evil.example", HOST)).toBe(true);
  });

  it("lets our own pages write — this is the side panel's path", () => {
    // The panel frames the app's own pages, so their fetches carry this Origin.
    expect(isSameSiteRequest("POST", SELF, HOST)).toBe(true);
    expect(isSameSiteRequest("PATCH", `${SELF}/`, HOST)).toBe(true);
  });

  it("refuses a write from another site — finding C-2", () => {
    expect(isSameSiteRequest("POST", "https://evil.example", HOST)).toBe(false);
    expect(isSameSiteRequest("DELETE", "https://evil.example", HOST)).toBe(false);
  });

  it("refuses a lookalike host", () => {
    expect(isSameSiteRequest("POST", "https://ascent-companion.vercel.app.evil.com", HOST)).toBe(
      false,
    );
    expect(isSameSiteRequest("POST", "https://notascent-companion.vercel.app", HOST)).toBe(false);
  });

  it("refuses the opaque origin a sandboxed iframe sends", () => {
    expect(isSameSiteRequest("POST", "null", HOST)).toBe(false);
  });

  it("allows a write with no Origin — a scheduler, not a browser", () => {
    // Browsers always send Origin on POST, so a cross-site attack cannot omit
    // it. Vercel Cron does, and authenticates itself with a bearer secret.
    expect(isSameSiteRequest("POST", null, HOST)).toBe(true);
    expect(isSameSiteRequest("POST", "", HOST)).toBe(true);
  });

  it("refuses a write when the host header is missing and the origin is not", () => {
    expect(isSameSiteRequest("POST", "https://evil.example", null)).toBe(false);
  });

  it("honours a second domain from the env list", () => {
    const extra = "https://assistant.ascentbuildingco.com";
    expect(isSameSiteRequest("POST", extra, HOST, extra)).toBe(true);
    expect(isSameSiteRequest("POST", extra, HOST)).toBe(false);
  });
});
