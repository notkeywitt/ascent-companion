import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The store against a real throwaway libSQL file. The Apps Script bridge is not
 * configured here, so the one-time sheet copy is skipped and the table starts blank.
 */
beforeAll(() => {
  process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "cd-")), "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
});

describe("company details", () => {
  it("starts blank, saves, and reports only real changes", async () => {
    const m = await import("./companyDetails");
    expect((await m.readDetails()).values.tax).toBe("");

    const first = await m.writeDetails({ tax: "0.0835", ubi: "602737647" }, "a@x.com");
    expect(first.map((c) => c.key).sort()).toEqual(["tax", "ubi"]);

    const again = await m.writeDetails({ tax: "0.0835", po: "0.18" }, "b@x.com");
    expect(again).toEqual([{ key: "po", before: "", after: "0.18" }]);

    const state = await m.readDetails();
    expect(state.values).toMatchObject({ tax: "0.0835", po: "0.18", ubi: "602737647" });
    expect(state.updatedBy).toBe("b@x.com");
  });

  it("stores, lists without bytes, reads back, renames and deletes a document", async () => {
    const m = await import("./companyDetails");
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const id = await m.addDocument({ name: "Reseller permit", fileName: "p.pdf", mime: "application/pdf", bytes, by: "a@x.com" });

    const [listed] = await m.listDocuments();
    expect(listed).toMatchObject({ id, name: "Reseller permit", size: 4 });
    expect("bytes" in listed).toBe(false);

    const got = await m.getDocument(id);
    expect([...got!.bytes]).toEqual([37, 80, 68, 70]);

    await m.renameDocument(id, "Reseller permit 2026");
    expect((await m.getDocument(id))!.doc.name).toBe("Reseller permit 2026");

    await m.deleteDocument(id);
    expect(await m.getDocument(id)).toBeNull();
  });
});
