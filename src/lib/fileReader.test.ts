import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAppsScriptOrThrow, getFileById, kept } = vi.hoisted(() => ({
  callAppsScriptOrThrow: vi.fn(async (_b: unknown, _o?: unknown): Promise<unknown> => ({})),
  getFileById: vi.fn(async (_c: unknown, _id: string): Promise<unknown> => null),
  kept: { rows: [] as unknown[] },
}));
vi.mock("@/lib/appsScript", () => ({ callAppsScriptOrThrow }));
vi.mock("@/lib/jobtread", () => ({ getFileById }));
vi.mock("@/lib/claudeExtract", () => ({ ocrScanWithClaude: vi.fn() }));
vi.mock("@/db", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => kept.rows };
  return {
    ensureDb: async () => {},
    db: {
      select: () => chain,
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
    },
  };
});

import { isJobTreadFileUrl, pagesFrom, readFile } from "./fileReader";
import type { PaveConfig } from "./jobtread";

const cfg = {} as PaveConfig;
const doc = (n: number, line: (p: number) => string) =>
  Array.from({ length: n }, (_, i) => `[Page ${i + 1}]\n${line(i + 1)}\n`).join("\n");

beforeEach(() => {
  kept.rows = [];
  callAppsScriptOrThrow.mockReset();
  getFileById.mockReset();
  process.env.JOB_FOLDERS_DRIVE_ID = "ROOT";
});

describe("isJobTreadFileUrl", () => {
  it("fetches from JobTread's file host only", () => {
    expect(isJobTreadFileUrl("https://cdn.jobtread.com/abc")).toBe(true);
    expect(isJobTreadFileUrl("http://cdn.jobtread.com/abc")).toBe(false);
    expect(isJobTreadFileUrl("https://cdn.jobtread.com.evil.io/abc")).toBe(false);
    expect(isJobTreadFileUrl("not a url")).toBe(false);
  });
});

describe("pagesFrom", () => {
  it("hands back whole pages up to the chunk, and where to go on", () => {
    const text = doc(5, (p) => `page ${p} `.repeat(400)); // ~3,600 chars a page
    const r = pagesFrom(text, 5, 1);
    expect([r.fromPage, r.toPage, r.nextPage]).toEqual([1, 2, 3]);
    expect(r.text).toMatch(/^\[Page 1\]/);
    expect(pagesFrom(text, 5, 5)).toMatchObject({ fromPage: 5, toPage: 5, nextPage: 0 });
    expect(pagesFrom(text, 5, 99)).toMatchObject({ fromPage: 5 });
  });
});

describe("readFile", () => {
  it("answers from kept text without fetching again", async () => {
    kept.rows = [{ key: "jobtread:22PXmQKk38kg", name: "Roof spec.pdf", pages: 3, text: doc(3, (p) => (p === 2 ? "Panel color: Charcoal Grey" : "x")), note: "", readAt: "2026-10-01T00:00:00Z" }];
    const r = await readFile(cfg, { jobtreadFileId: "22PXmQKk38kg" }, { words: ["charcoal"] });
    expect(r).toMatchObject({ name: "Roof spec.pdf", hits: 1, snippets: [{ page: 2 }] });
    expect(getFileById).not.toHaveBeenCalled();
  });

  it("reads only PDFs from JobTread", async () => {
    getFileById.mockResolvedValueOnce({ id: "f1", name: "deck.jpg", type: "image/jpeg", size: 10, url: "https://cdn.jobtread.com/x" });
    expect(await readFile(cfg, { jobtreadFileId: "f1abcd" })).toEqual({ error: expect.stringMatching(/Only PDFs/) });
  });

  it("asks Drive to keep to the job folders, and refuses an answer that did not check", async () => {
    callAppsScriptOrThrow.mockResolvedValueOnce({ name: "a.pdf", data: "" });
    const r = await readFile(cfg, { drive: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view" });
    expect(callAppsScriptOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "getDriveFilePdf", id: "1AbCdEfGhIjKlMnOpQrStUv", rootId: "ROOT" }),
      expect.anything(),
    );
    expect(r).toEqual({ error: expect.stringMatching(/Apps Script side is deployed/) });
  });

  it("needs a file to read", async () => {
    expect(await readFile(cfg, {})).toEqual({ error: expect.stringMatching(/Drive link or a JobTread file id/) });
  });
});
