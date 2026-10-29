import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({
  saved: [] as Record<string, unknown>[],
  cursor: "",
  setTo: "",
}));
const listSpaceMessages = vi.hoisted(() => vi.fn());

vi.mock("@/lib/chatMemory", () => ({
  chatUserNames: async () => new Map([["users/1", "Ty O'Steen"]]),
  linkedSpaces: async () => [],
  saveTurn: async (t: Record<string, unknown>) => {
    mem.saved.push(t);
  },
  setSpaceSyncedTo: async (_s: string, to: string) => {
    mem.setTo = to;
  },
  spaceSyncedTo: async () => mem.cursor,
}));
vi.mock("@/lib/googleChatPost", () => ({ listSpaceMessages }));

import { isBotTraffic, syncSpace } from "./chatSync";

beforeEach(() => {
  mem.saved = [];
  mem.cursor = "";
  mem.setTo = "";
  listSpaceMessages.mockReset();
});

const msg = (over: Record<string, unknown>) => ({
  name: "spaces/S/messages/x",
  createTime: "2026-10-28T17:00:00Z",
  text: "the tile is delayed to Friday",
  sender: { name: "users/1", type: "HUMAN" },
  thread: { name: "spaces/S/threads/T" },
  ...over,
});

describe("isBotTraffic", () => {
  it("skips the bot's own posts, @mentions of it and slash commands", () => {
    expect(isBotTraffic(msg({ sender: { type: "BOT" } }))).toBe(true);
    expect(isBotTraffic(msg({ annotations: [{ type: "USER_MENTION", userMention: { user: { type: "BOT" } } }] }))).toBe(true);
    expect(isBotTraffic(msg({ slashCommand: { commandId: "1" } }))).toBe(true);
    expect(isBotTraffic(msg({ annotations: [{ type: "USER_MENTION", userMention: { user: { type: "HUMAN" } } }] }))).toBe(false);
  });
});

describe("syncSpace", () => {
  it("keeps what people said, with who and when, under the job, and moves the cursor", async () => {
    listSpaceMessages.mockResolvedValueOnce({
      messages: [
        msg({}),
        msg({ createTime: "2026-10-28T17:05:00Z", sender: { type: "BOT" }, text: "Noted." }),
        msg({ createTime: "2026-10-28T17:06:00Z", sender: { name: "users/9" }, text: "ok" }),
      ],
      more: false,
    });
    expect(await syncSpace("spaces/S", "job1", "tok")).toBe(2);
    expect(mem.saved[0]).toEqual({
      space: "spaces/S",
      thread: "spaces/S/threads/T",
      jobId: "job1",
      kind: "said",
      author: "Ty O'Steen",
      text: "the tile is delayed to Friday",
      at: "2026-10-28T17:00:00Z",
    });
    expect(mem.saved[1]).toMatchObject({ author: "Someone", text: "ok" });
    expect(mem.setTo).toBe("2026-10-28T17:06:00Z");
  });

  it("starts from the cursor, or 90 days back on the first read", async () => {
    listSpaceMessages.mockResolvedValue({ messages: [], more: false });
    mem.cursor = "2026-10-01T00:00:00Z";
    await syncSpace("spaces/S", "job1", "tok");
    expect(listSpaceMessages).toHaveBeenLastCalledWith("spaces/S", "2026-10-01T00:00:00Z", "tok", 5);
    mem.cursor = "";
    await syncSpace("spaces/S", "job1", "tok");
    const since = Date.parse(listSpaceMessages.mock.calls[1][1] as string);
    expect(Math.round((Date.now() - since) / 86_400_000)).toBe(90);
    expect(mem.setTo).toBe("");
  });
});
