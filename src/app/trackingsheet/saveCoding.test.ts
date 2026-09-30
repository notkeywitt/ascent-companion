import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The draft store talks to storage and the network; Save only needs to know
// whether it was told to drop the draft.
vi.mock("@/lib/codingDraft", () => ({ discardDraft: vi.fn() }));

import { discardDraft } from "@/lib/codingDraft";
import { saveCoding, type SaveCodingInput } from "./saveCoding";
import type { BoardPayload } from "./Board";

type Call = { url: string; body: Record<string, unknown> };

/** A fake fetch: records each call and answers `ok` unless the URL is in `fail`. */
function fakeFetch(fail: string[] = []) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : {} });
    const bad = fail.includes(url);
    const json = bad
      ? { error: `${url} refused` }
      : url === "/api/code"
        ? { results: [{ ok: true }] }
        : url === "/api/labor-review"
          ? { results: [{ ok: true }] }
          : {};
    return { ok: !bad, json: async () => json } as Response;
  });
  return { fn, calls };
}

const bill = {
  id: "doc1",
  label: "Dirt Doctors",
  status: "draft",
  name: "Bill",
  nonRecoverableTax: 0,
  recordsTax: false,
};
const line = {
  id: "line1",
  docId: "doc1",
  billStatus: "draft",
  name: "Excavation",
  cost: 1000,
  quantity: 1,
  unitCost: 1000,
  code: "31 23 00",
  codeName: "Excavation",
  jobCostItemId: "leafA",
};
const data = {
  job: { id: "job1", name: "Studio PreCon", address: "", customer: "" },
  bills: [bill],
  billTotal: 1000,
  lines: [line],
  timeEntries: [],
  budget: [
    { id: "leafA", number: "31 23 00", name: "Excavation" },
    { id: "leafB", number: "02 41 13", name: "Selective Demolition" },
  ],
  costDetail: { divisions: [], budgetBasis: "" },
  writesEnabled: true,
} as unknown as BoardPayload;

function input(over: Partial<SaveCodingInput> = {}): SaveCodingInput {
  return {
    data,
    dirty: true,
    setSyncing: vi.fn(),
    setSyncMsg: vi.fn(),
    staged: new Map([["line1", "leafB"]]),
    edits: {},
    linesByDoc: new Map([["doc1", [line] as never]]),
    billTax: () => 0,
    timeStaged: new Map([["t1", "leafB"]]),
    timeEdits: { t2: { hours: "2" } as never },
    typeEdits: { doc1: "Expense" },
    taxEdits: { doc1: "12.50" },
    combinePending: null,
    setCombining: vi.fn(),
    setCombineMsg: vi.fn(),
    setCombinePending: vi.fn(),
    setRestoreMsg: vi.fn(),
    draftKey: "job1|2026-09",
    load: vi.fn(async () => {}),
    restoreStartedRef: { current: "job1|2026-09" },
    autosaveArmedRef: { current: "job1|2026-09" },
    ...over,
  };
}

let fetchMock: ReturnType<typeof fakeFetch>;
beforeEach(() => {
  vi.mocked(discardDraft).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveCoding", () => {
  it("writes in the fixed order: lines, labor, entry fixes, bill type, tax", async () => {
    fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock.fn);
    const inp = input();
    await saveCoding(inp);
    expect(fetchMock.calls.map((c) => c.url)).toEqual([
      "/api/code",
      "/api/labor-review",
      "/api/time-entry",
      "/api/bill-fields",
      "/api/bill-tax",
    ]);
    // The whole bill goes, recoded onto the staged leaf.
    const code = fetchMock.calls[0].body as {
      docId: string;
      changes: { costItemId: string; jobCostItemId?: string }[];
    };
    expect(code.docId).toBe("doc1");
    expect(code.changes[0]).toMatchObject({ costItemId: "line1", jobCostItemId: "leafB" });
    expect(fetchMock.calls[1].body).toEqual({ changes: [{ id: "t1", costItemId: "leafB" }] });
    expect(fetchMock.calls[2].body).toEqual({ id: "t2", hours: "2" });
    expect(fetchMock.calls[3].body).toEqual({ docId: "doc1", name: "Expense" });
    expect(fetchMock.calls[4].body).toEqual({ docId: "doc1", taxAmount: 12.5 });
  });

  it("on full success drops the draft and re-reads the month", async () => {
    fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock.fn);
    const inp = input();
    await saveCoding(inp);
    expect(discardDraft).toHaveBeenCalledWith("job1|2026-09");
    expect(inp.load).toHaveBeenCalledTimes(1);
    expect(vi.mocked(inp.setSyncMsg).mock.calls.at(-1)?.[0]).toMatchObject({ tone: "success" });
  });

  it("on a partial failure keeps the draft and re-arms its restore", async () => {
    fetchMock = fakeFetch(["/api/bill-tax"]);
    vi.stubGlobal("fetch", fetchMock.fn);
    const inp = input();
    await saveCoding(inp);
    expect(discardDraft).not.toHaveBeenCalled();
    expect(inp.restoreStartedRef.current).toBe("");
    expect(inp.autosaveArmedRef.current).toBe("");
    expect(inp.load).toHaveBeenCalledTimes(1);
    expect(vi.mocked(inp.setSyncMsg).mock.calls.at(-1)?.[0]).toMatchObject({ tone: "error" });
  });

  it("writes nothing when there is nothing staged or no month loaded", async () => {
    fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock.fn);
    await saveCoding(input({ dirty: false }));
    await saveCoding(input({ data: null }));
    expect(fetchMock.calls).toHaveLength(0);
  });

  it("runs a staged merge last, after every line write", async () => {
    fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock.fn);
    const combinePending = { docId: "doc1", keepId: "line1", deleteIds: ["line2"] } as never;
    await saveCoding(input({ combinePending }));
    expect(fetchMock.calls.at(-1)?.url).toBe("/api/combine-lines");
  });
});
