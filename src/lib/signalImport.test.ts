import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({ threads: new Set<string>(), saved: [] as Record<string, unknown>[] }));

vi.mock("@/lib/chatMemory", () => ({
  storedThreads: async (ids: string[]) => new Set(ids.filter((t) => mem.threads.has(t))),
  saveTurns: async (rows: Record<string, unknown>[]) => {
    for (const r of rows) {
      mem.saved.push(r);
      mem.threads.add(String(r.thread));
    }
  },
}));

import { cleanSignalBatch, importSignalMessages, signalSecretOk, type SignalMessage } from "./signalImport";

beforeEach(() => {
  mem.threads = new Set();
  mem.saved = [];
});

const msg = (over: Partial<SignalMessage> = {}): SignalMessage => ({
  id: "m1",
  chat: "Smith Kitchen",
  jobId: "22Nabc",
  author: "Ty",
  text: "tile is delayed to Friday",
  at: "2026-10-28T17:00:00.000Z",
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
    const r = cleanSignalBatch({ messages: [{ ...msg(), at: "2026-10-28T10:00:00-07:00", author: "" }] });
    expect(r).toEqual({ messages: [msg({ author: "Someone" })] });
  });

  it("refuses a body without a list, an oversize batch or a message missing a field", () => {
    expect(cleanSignalBatch(null)).toHaveProperty("error");
    expect(cleanSignalBatch({ messages: Array.from({ length: 201 }, () => msg()) })).toHaveProperty("error");
    expect(cleanSignalBatch({ messages: [msg({ text: " " })] })).toHaveProperty("error");
    expect(cleanSignalBatch({ messages: [msg({ at: "yesterday" })] })).toHaveProperty("error");
  });
});

describe("importSignalMessages", () => {
  it("stores a job message as a 'said' turn in the chat's signal space", async () => {
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
  });

  it("stores a batch sent twice only once", async () => {
    const batch = [msg(), msg({ id: "m2", chat: "Ascent Crew", jobId: "", text: "Smith tile Friday" })];
    expect(await importSignalMessages(batch)).toEqual({ stored: 2, skipped: 0 });
    expect(await importSignalMessages(batch)).toEqual({ stored: 0, skipped: 2 });
    expect(mem.saved).toHaveLength(2);
  });

  it("stores a message repeated within one batch once", async () => {
    expect(await importSignalMessages([msg(), msg()])).toEqual({ stored: 1, skipped: 1 });
  });
});
