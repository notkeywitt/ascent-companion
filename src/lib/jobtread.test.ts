import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pave, type PaveConfig } from "./jobtread";

/**
 * pave()'s retry policy.
 *
 * COMPANION_WRITES_ENABLED is armed in production, so these paths are live
 * against the real JobTread org. The failure this guards against is concrete: if
 * a createDocument gets a 502 AFTER JobTread already created the bill, retrying
 * bills the job twice and nobody notices until reconciliation.
 *
 * So: reads may repeat, mutations may not — ever, for any reason.
 */

const cfg: PaveConfig = { grantKey: "test-key", orgId: "org1" };

const reply = (status: number, body: string) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response;

const okBody = (data: unknown) => JSON.stringify(data);

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.restoreAllMocks());

describe("pave — reads", () => {
  it("returns parsed data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody({ job: { id: "j1" } }))));
    await expect(pave(cfg, { job: { $: { id: "j1" }, id: {} } })).resolves.toEqual({
      job: { id: "j1" },
    });
  });

  it("retries a transient 502 and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(502, "bad gateway"))
      .mockResolvedValueOnce(reply(200, okBody({ job: { id: "j1" } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, { job: { id: {} } })).resolves.toEqual({ job: { id: "j1" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 (rate limited)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, "slow down"))
      .mockResolvedValueOnce(reply(200, okBody({ organization: {} })));
    vi.stubGlobal("fetch", fetchMock);
    await pave(cfg, { organization: { id: {} } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(reply(200, okBody({ job: {} })));
    vi.stubGlobal("fetch", fetchMock);
    await pave(cfg, { job: { id: {} } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(503, "unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, { job: { id: {} } })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a query error returned as a 200 with `errors`", async () => {
    // Repeating a malformed query just fails again — and it isn't transient.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reply(200, okBody({ errors: [{ message: "no such field" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, { job: { nope: {} } })).rejects.toThrow(/no such field/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a bad grant key (plain-text non-JSON body)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(401, "Supplied key is invalid"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, { job: { id: {} } })).rejects.toThrow(/Supplied key is invalid/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pave — mutations are sent exactly once", () => {
  // Each of these is a real write path in the app today.
  const mutations: Record<string, unknown>[] = [
    { createDocument: { $: { type: "vendorBill" } } },
    { updateCostItem: { $: { id: "c1" } } },
    { deleteCostItem: { $: { id: "c1" } } },
    { createTimeEntry: { $: { userId: "u1" } } },
    { deleteTimeEntry: { $: { id: "t1" } } },
    { updateDocument: { $: { id: "d1" } } },
  ];

  it.each(mutations)("never retries %o on a 502", async (query) => {
    const fetchMock = vi.fn().mockResolvedValue(reply(502, "bad gateway"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, query)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a mutation on a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, { createDocument: {} })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a mutation on a 429 either", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(429, "slow down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, { createPayment: {} })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when a mutation rides alongside a read in one query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(503, "unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pave(cfg, { job: { id: {} }, updateCostItem: {} })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Guards the exact false-positive that would break ordinary reads: selecting
  // createdAt/updatedAt must not make a read look like a write.
  it("still retries a read that merely selects createdAt / updatedAt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(503, "unavailable"))
      .mockResolvedValueOnce(reply(200, okBody({ document: {} })));
    vi.stubGlobal("fetch", fetchMock);
    await pave(cfg, { document: { $: { id: "d1" }, createdAt: {}, updatedAt: {} } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("pave — request shape", () => {
  it("injects the grant key at the query root", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, okBody({})));
    vi.stubGlobal("fetch", fetchMock);
    await pave(cfg, { job: { id: {} } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.query.$.grantKey).toBe("test-key");
    expect(body.query.job).toEqual({ id: {} });
  });

  it("serializes the body once and reuses it across retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(503, "x"))
      .mockResolvedValueOnce(reply(200, okBody({})));
    vi.stubGlobal("fetch", fetchMock);
    await pave(cfg, { job: { id: {} } });
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  });
});
