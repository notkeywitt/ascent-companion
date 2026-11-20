import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/** The store against a real throwaway libSQL file. */
beforeAll(() => {
  process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "veh-")), "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
});

describe("vehicles", () => {
  it("adds, edits, holds a photo and files, and deletes with its files", async () => {
    const m = await import("./vehicles");
    const id = await m.addVehicle({ name: "F-250", plate: "ABC123" }, "a@x.com");

    expect(await m.updateVehicle(id, { plate: "ABC123", vin: "1FT" }, "b@x.com")).toEqual([
      { key: "vin", before: "", after: "1FT" },
    ]);
    expect(await m.updateVehicle(999, { vin: "x" }, "b@x.com")).toBeNull();

    await m.setVehiclePhoto(id, { bytes: new Uint8Array([1, 2]), mime: "image/png" }, "a@x.com");
    expect((await m.getVehiclePhoto(id))?.mime).toBe("image/png");
    const fileId = await m.addVehicleFile({
      vehicleId: id,
      name: "Registration",
      fileName: "r.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([37, 80]),
      by: "a@x.com",
    });

    const [v] = await m.listVehicles();
    expect(v).toMatchObject({ id, hasPhoto: true, values: { name: "F-250", vin: "1FT" } });
    expect(v.files.map((f) => f.id)).toEqual([fileId]);
    expect("bytes" in v.files[0]).toBe(false);

    await m.setVehiclePhoto(id, null, "a@x.com");
    expect(await m.getVehiclePhoto(id)).toBeNull();

    await m.deleteVehicle(id);
    expect(await m.listVehicles()).toEqual([]);
    expect(await m.getVehicleFile(fileId)).toBeNull();
  });
});
