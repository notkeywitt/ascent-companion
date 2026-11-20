/**
 * Company vehicles — the DB half. SERVER ONLY.
 * Tables: `vehicles`, `vehicle_files` (src/db/schema.ts). Rules: vehicleRules.ts.
 */
import { asc, desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { vehicleFiles, vehicles } from "@/db/schema";
import { VEHICLE_FIELDS, type VehicleKey, type VehicleValues } from "@/lib/vehicleRules";

export interface VehicleFile {
  id: number;
  vehicleId: number;
  name: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface Vehicle {
  id: number;
  values: VehicleValues;
  hasPhoto: boolean;
  updatedAt: string;
  updatedBy: string;
  files: VehicleFile[];
}

/** DB column for each key. */
const COL = {
  name: "name",
  plate: "plate",
  vin: "vin",
  insurance_carrier: "insuranceCarrier",
  insurance_policy: "insurancePolicy",
  insurance_expiry: "insuranceExpiry",
  notes: "notes",
} as const satisfies Record<VehicleKey, keyof typeof vehicles.$inferSelect>;

const fileColumns = {
  id: vehicleFiles.id,
  vehicleId: vehicleFiles.vehicleId,
  name: vehicleFiles.name,
  fileName: vehicleFiles.fileName,
  mime: vehicleFiles.mime,
  size: vehicleFiles.size,
  uploadedAt: vehicleFiles.uploadedAt,
  uploadedBy: vehicleFiles.uploadedBy,
};

const toRow = (v: Partial<VehicleValues>) => {
  const row: Partial<Record<(typeof COL)[VehicleKey], string>> = {};
  for (const f of VEHICLE_FIELDS) if (v[f.key] !== undefined) row[COL[f.key]] = v[f.key];
  return row;
};

/** Every vehicle by name, with its files (newest first). Never selects bytes. */
export async function listVehicles(): Promise<Vehicle[]> {
  await ensureDb();
  const [rows, files] = await Promise.all([
    db
      .select({
        id: vehicles.id,
        name: vehicles.name,
        plate: vehicles.plate,
        vin: vehicles.vin,
        insuranceCarrier: vehicles.insuranceCarrier,
        insurancePolicy: vehicles.insurancePolicy,
        insuranceExpiry: vehicles.insuranceExpiry,
        notes: vehicles.notes,
        photoMime: vehicles.photoMime,
        updatedAt: vehicles.updatedAt,
        updatedBy: vehicles.updatedBy,
      })
      .from(vehicles)
      .orderBy(asc(vehicles.name)),
    db.select(fileColumns).from(vehicleFiles).orderBy(desc(vehicleFiles.id)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    values: Object.fromEntries(VEHICLE_FIELDS.map((f) => [f.key, r[COL[f.key]]])) as VehicleValues,
    hasPhoto: !!r.photoMime,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    files: files.filter((f) => f.vehicleId === r.id),
  }));
}

export async function getVehicle(id: number): Promise<Vehicle | null> {
  return (await listVehicles()).find((v) => v.id === id) ?? null;
}

export async function addVehicle(values: Partial<VehicleValues>, by: string): Promise<number> {
  await ensureDb();
  const [row] = await db
    .insert(vehicles)
    .values({ name: "", ...toRow(values), updatedAt: new Date().toISOString(), updatedBy: by })
    .returning({ id: vehicles.id });
  return row.id;
}

/** Save the changed fields. Returns what each was before, for the journal. */
export async function updateVehicle(
  id: number,
  changes: Partial<VehicleValues>,
  by: string,
): Promise<{ key: VehicleKey; before: string; after: string }[] | null> {
  const current = await getVehicle(id);
  if (!current) return null;
  const changed = VEHICLE_FIELDS.filter(
    (f) => changes[f.key] !== undefined && changes[f.key] !== current.values[f.key],
  ).map((f) => ({ key: f.key, before: current.values[f.key], after: changes[f.key]! }));
  if (changed.length === 0) return [];
  await db
    .update(vehicles)
    .set({ ...toRow(Object.fromEntries(changed.map((c) => [c.key, c.after]))), updatedAt: new Date().toISOString(), updatedBy: by })
    .where(eq(vehicles.id, id));
  return changed;
}

/** Deletes the vehicle and its files. */
export async function deleteVehicle(id: number): Promise<void> {
  await ensureDb();
  await db.delete(vehicleFiles).where(eq(vehicleFiles.vehicleId, id));
  await db.delete(vehicles).where(eq(vehicles.id, id));
}

/** Set (or with null bytes, clear) the vehicle's photo. */
export async function setVehiclePhoto(id: number, photo: { bytes: Uint8Array; mime: string } | null, by: string) {
  await ensureDb();
  await db
    .update(vehicles)
    .set({
      photo: photo ? Buffer.from(photo.bytes) : null,
      photoMime: photo?.mime ?? "",
      updatedAt: new Date().toISOString(),
      updatedBy: by,
    })
    .where(eq(vehicles.id, id));
}

export async function getVehiclePhoto(id: number): Promise<{ bytes: Buffer; mime: string } | null> {
  await ensureDb();
  const [row] = await db
    .select({ photo: vehicles.photo, mime: vehicles.photoMime })
    .from(vehicles)
    .where(eq(vehicles.id, id));
  return row?.photo ? { bytes: row.photo, mime: row.mime } : null;
}

export async function addVehicleFile(d: {
  vehicleId: number;
  name: string;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
  by: string;
}): Promise<number> {
  await ensureDb();
  const [row] = await db
    .insert(vehicleFiles)
    .values({
      vehicleId: d.vehicleId,
      name: d.name,
      fileName: d.fileName,
      mime: d.mime,
      size: d.bytes.byteLength,
      bytes: Buffer.from(d.bytes),
      uploadedAt: new Date().toISOString(),
      uploadedBy: d.by,
    })
    .returning({ id: vehicleFiles.id });
  return row.id;
}

export async function getVehicleFile(id: number): Promise<{ file: VehicleFile; bytes: Buffer } | null> {
  await ensureDb();
  const [row] = await db.select().from(vehicleFiles).where(eq(vehicleFiles.id, id));
  if (!row) return null;
  const { bytes, ...file } = row;
  return { file, bytes };
}

export async function deleteVehicleFile(id: number): Promise<void> {
  await ensureDb();
  await db.delete(vehicleFiles).where(eq(vehicleFiles.id, id));
}
