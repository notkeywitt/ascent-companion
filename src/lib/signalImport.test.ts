import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({
  threads: new Set<string>(),
  saved: [] as Record<string, unknown>[],
  rules: new Map<string, { rule: string; jobId: string }>(),
  cursors: new Map<string, number>(),
}));

vi.mock("@/lib/chatMemory", () => ({
  storedThreads: async (ids: string[]) => new Set(ids.filter((t) => mem.threads.has(t))),
  saveTurns: async (rows: Record<string, unknown>[]) => {
    for (const r of rows) {
      mem.saved.push(r);
      mem.threads.add(String(r.thread));
    }
  },
}));
vi.mock("@/lib/signalChats", () => ({
  SENT_RULES: ["job", "office"],
  signalChatRules: async () => mem.rules,
  advanceSignalChat: async (chat: string, to: number) => {
    mem.cursors.set(chat, Math.max(mem.cursors.get(chat) ?? 0, to));
  },
}));

import { cleanChatReport, cleanSignalBatch, importSignalMessages, signalSecretOk, type SignalMessage } from "./signalImport";

beforeEach(() => {
  mem.threads = new Set();
  mem.saved = [];
  mem.cursors = new Map();
  mem.rules = new Map([
    ["Smith Kitchen", { rule: "job", jobId: "22Nabc" }],
    ["Ascent Crew", { rule: "office", jobId: "" }],
    ["Mom", { rule: "skip", jobId: "" }],
    ["New Group", { rule: "", jobId: "" }],
  ]);
});

const msg = (over: Partial<SignalMessage> = {}): SignalMessage => ({
  id: "m1",
  chat: "Smith Kitchen",
  author: "Ty",
  text: "tile is delayed to Friday",
  at: "2026-10-28T17:00:00.000Z",
  received: 10,
  ...over,
});

describe("signalSecretOk", () => {
  it("accepts only the exact bearer secret", () => {
    expect(signalSecretOk("Bearer s3cret", "s3cret")).toBe(true);
    expect(signalSecretOk("bearer s3cret ", " s3cret")).toBe(true);
    expect(signalSecretOk("Bearer wrong", "s3cret")).toBe(false);
    expect(signalSecretOk("", "s3cret")).toBe(false);
    expect(signalSecretOk("Bearer s3cret", "")).toBe(false);
    expect(signalSecretOk("s3cret", "s3cret")).toBe(false);
  });
});

describe("cleanSignalBatch", () => {
  it("keeps well-formed messages and normalizes the time", () => {
    const r = cleanSignalBatch([{ ...msg(), at: "2026-10-28T10:00:00-07:00", author: "", jobId: "ignored" }]);
    expect(r).toEqual({ messages: [msg({ author: "Someone" })] });
  });

  it("refuses a missing list, an oversize batch or a message missing a field", () => {
    expect(cleanSignalBatch(undefined)).toHaveProperty("error");
    expect(cleanSignalBatch(Array.from({ length: 201 }, () => msg()))).toHaveProperty("error");
    expect(cleanSignalBatch([msg({ text: " " })])).toHaveProperty("error");
    expect(cleanSignalBatch([msg({ at: "yesterday" })])).toHaveProperty("error");
  });
});

describe("cleanChatReport", () => {
  it("keeps each chat's name, type, count and last time", () => {
    expect(cleanChatReport([{ chat: " Office ", type: "group", messages: 12.7, lastAt: "2026-10-30T10:00:00Z" }, { chat: "Ty", type: "x" }])).toEqual({
      chats: [
        { chat: "Office", type: "group", messages: 12, lastAt: "2026-10-30T10:00:00.000Z" },
        { chat: "Ty", type: "private", messages: 0, lastAt: "" },
      ],
    });
    expect(cleanChatReport([{ chat: "" }])).toHaveProperty("error");
    expect(cleanChatReport("x")).toHaveProperty("error");
  });
});

describe("importSignalMessages", () => {
  it("files a job chat's message under the job the rule names", async () => {
    await importSignalMessages([msg()]);
    expect(mem.saved).toEqual([
      {
        space: "signal:Smith Kitchen",
        thread: "signal:m1",
        jobId: "22Nabc",
        kind: "said",
        author: "Ty",
        text: "tile is delayed to Friday",
        at: "2026-10-28T17:00:00.000Z",
      },
    ]);
    expect(mem.cursors.get("Smith Kitchen")).toBe(10);
  });

  it("refuses chats set to skip, not set, or never reported", async () => {
    const r = await importSignalMessages([
      msg({ id: "a", chat: "Mom" }),
      msg({ id: "b", chat: "New Group" }),
      msg({ id: "c", chat: "Unknown" }),
      msg({ id: "d", chat: "Ascent Crew", received: 7 }),
    ]);
    expect(r).toEqual({ stored: 1, skipped: 0, refused: 3 });
    expect(mem.saved.map((s) => [s.space, s.jobId])).toEqual([["signal:Ascent Crew", ""]]);
    expect([...mem.cursors.keys()]).toEqual(["Ascent Crew"]);
  });

  it("stores a batch sent twice only once", async () => {
    const batch = [msg(), msg({ id: "m2", chat: "Ascent Crew", text: "Smith tile Friday" })];
    expect(await importSignalMessages(batch)).toEqual({ stored: 2, skipped: 0, refused: 0 });
    expect(await importSignalMessages(batch)).toEqual({ stored: 0, skipped: 2, refused: 0 });
    expect(mem.saved).toHaveLength(2);
  });

  it("stores a message repeated within one batch once", async () => {
    expect(await importSignalMessages([msg(), msg()])).toEqual({ stored: 1, skipped: 1, refused: 0 });
  });
});
