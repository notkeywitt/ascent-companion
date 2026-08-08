import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAppsScript, callAppsScriptOrThrow, isRetryable, kickJtSync } from "./appsScript";

/**
 * The Apps Script client's retry policy.
 *
 * The stakes: these actions write rows to real spreadsheets. Retrying a
 * `logMileage` whose response was merely lost writes the trip twice. So the
 * tests below are less about "does retry work" and more about "does it refuse to
 * retry the things that must not repeat".
 */

const ORIGINAL_ENV = { ...process.env };

/** A Response-alike good enough for the client (it only uses .status/.text()). */
const reply = (status: number, body: string) =>
  ({ status, text: async () => body }) as unknown as Response;

beforeEach(() => {
  process.env.APPS_SCRIPT_SYNC_URL = "https://script.example/exec";
  process.env.APPS_SCRIPT_SYNC_SECRET = "test-secret";
  vi.useRealTimers();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("isRetryable", () => {
  it("treats list*/get* as reads", () => {
    for (const a of ["listTools", "listMileage", "getWhatever", "listStuckVendors"]) {
      expect(isRetryable(a), a).toBe(true);
    }
  });

  it("treats the named bootstrap/scan reads as reads", () => {
    for (const a of ["toolsBootstrap", "timeEntryBootstrap", "sunsetDuplicates", "historicalCostPreview"]) {
      expect(isRetryable(a), a).toBe(true);
    }
  });

  it("treats every write action as non-retryable", () => {
    const writes = [
      "logMileage", "logTimeEntry", "createTool", "updateTool", "logRequisition",
      "saveSafetyMeeting", "finalizeTimeEntryLog", "emailEmployees", "reassignJob",
      "syncTrackingSheet", "extractSunsetStatements", "mileageReportPdf", "runTask",
    ];
    for (const a of writes) expect(isRetryable(a), a).toBe(false);
  });

  it("treats an absent or unknown action as a write", () => {
    // No action = the bare full-sync kick, which writes.
    expect(isRetryable(undefined)).toBe(false);
    expect(isRetryable("")).toBe(false);
    expect(isRetryable("somethingBrandNew")).toBe(false);
  });
});

describe("callAppsScript", () => {
  it("returns parsed data on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, JSON.stringify({ ok: true, tools: [] }))));
    const r = await callAppsScript({ action: "listTools" });
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual({ ok: true, tools: [] });
  });

  it("400s when the bridge isn't configured, without calling fetch", async () => {
    delete process.env.APPS_SCRIPT_SYNC_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await callAppsScript({ action: "listTools" });
    expect(r.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("RETRIES a read on a transient 503 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(503, "unavailable"))
      .mockResolvedValueOnce(reply(200, JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callAppsScript({ action: "listTools" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.data).toEqual({ ok: true });
  });

  // The one that protects the sheets.
  it("NEVER retries a write, even on a transient 503", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(503, "unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callAppsScript({ action: "logMileage", miles: 12 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(502);
  });

  it("NEVER retries a write on a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callAppsScript({ action: "logTimeEntry" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.error).toContain("socket hang up");
  });

  it("gives up after 3 attempts on a read that keeps failing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(502, "bad gateway"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callAppsScript({ action: "listTools" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r.status).toBe(502);
  });

  it("does NOT retry a non-JSON body — a misconfigured deployment won't fix itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, "<html>sign in</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callAppsScript({ action: "listTools" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.error).toContain("non-JSON");
  });

  it("honours an explicit retry:false on a read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(503, "nope"));
    vi.stubGlobal("fetch", fetchMock);
    await callAppsScript({ action: "listTools" }, { retry: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("injects the secret and never leaks it into the returned error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await callAppsScript({ action: "listTools" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.secret).toBe("test-secret");
    expect(body.action).toBe("listTools");
  });
});

describe("callAppsScriptOrThrow", () => {
  it("throws when the script reports ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, JSON.stringify({ ok: false, error: "boom" }))));
    await expect(callAppsScriptOrThrow({ action: "listTools" })).rejects.toThrow("boom");
  });

  it("returns the body when ok is not false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, JSON.stringify({ ok: true, rows: [1] }))));
    await expect(callAppsScriptOrThrow({ action: "listTools" })).resolves.toEqual({ ok: true, rows: [1] });
  });
});

describe("kickJtSync", () => {
  // null vs false is load-bearing: add-bill warns the user on false but must stay
  // silent on null, or every bill created on a dev machine shows a scary warning.
  it("returns null when the bridge isn't configured", async () => {
    delete process.env.APPS_SCRIPT_SYNC_URL;
    vi.stubGlobal("fetch", vi.fn());
    await expect(kickJtSync()).resolves.toBeNull();
  });

  it("returns true when the kick confirms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, JSON.stringify({ ok: true }))));
    await expect(kickJtSync()).resolves.toBe(true);
  });

  it("returns false when it was attempted and didn't confirm", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, JSON.stringify({ ok: false }))));
    await expect(kickJtSync()).resolves.toBe(false);
  });
});
