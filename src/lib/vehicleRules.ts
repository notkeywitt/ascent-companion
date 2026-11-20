/**
 * Company vehicles — the pure half (no DB), safe in a client component.
 * The store is src/lib/vehicles.ts. Files reuse the document rules of
 * src/lib/companyDetailsRules.ts (PDF or photo, 4 MB cap).
 */

export type VehicleKey =
  | "name"
  | "plate"
  | "vin"
  | "insurance_carrier"
  | "insurance_policy"
  | "insurance_expiry"
  | "notes";

export interface VehicleField {
  key: VehicleKey;
  label: string;
  kind: "text" | "date" | "long";
  max: number;
}

export const VEHICLE_FIELDS: VehicleField[] = [
  { key: "name", label: "Name", kind: "text", max: 80 },
  { key: "plate", label: "Plate", kind: "text", max: 20 },
  { key: "vin", label: "VIN", kind: "text", max: 20 },
  { key: "insurance_carrier", label: "Insurance carrier", kind: "text", max: 80 },
  { key: "insurance_policy", label: "Policy no.", kind: "text", max: 60 },
  { key: "insurance_expiry", label: "Insurance expires", kind: "date", max: 10 },
  { key: "notes", label: "Notes", kind: "long", max: 2000 },
];

export type VehicleValues = Record<VehicleKey, string>;

export const EMPTY_VEHICLE: VehicleValues = {
  name: "",
  plate: "",
  vin: "",
  insurance_carrier: "",
  insurance_policy: "",
  insurance_expiry: "",
  notes: "",
};

/**
 * A vehicle from the browser, cleaned: known keys only, trimmed, capped. Plate
 * and VIN upper-cased; the expiry a real "YYYY-MM-DD" or blank. A new vehicle
 * needs a name.
 */
export function cleanVehicleInput(
  input: unknown,
  isNew: boolean,
): { values: Partial<VehicleValues>; error?: string } {
  const values: Partial<VehicleValues> = {};
  if (!input || typeof input !== "object") return { values, error: "Send the vehicle as an object." };
  const src = input as Record<string, unknown>;
  for (const f of VEHICLE_FIELDS) {
    if (src[f.key] === undefined) continue;
    let v = String(src[f.key] ?? "").trim();
    if (v.length > f.max) return { values, error: `${f.label} is over ${f.max} characters.` };
    if (f.key === "plate" || f.key === "vin") v = v.toUpperCase();
    if (f.kind === "date" && v && !isRealDay(v)) return { values, error: `${f.label} must be a date.` };
    values[f.key] = v;
  }
  if ((isNew || values.name !== undefined) && !values.name) return { values, error: "Give the vehicle a name." };
  return { values };
}

function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** The insurance's state on `today` ("YYYY-MM-DD"): expired, due within 30 days, fine, or unknown. */
export function insuranceState(expiry: string, today: string): "expired" | "soon" | "ok" | "" {
  if (!isRealDay(expiry) || !isRealDay(today)) return "";
  if (expiry < today) return "expired";
  const days = (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 30 ? "soon" : "ok";
}

/** "2026-10-19" → "Oct 19, 2026". Anything else as is. */
export function dayLabel(day: string): string {
  if (!isRealDay(day)) return day;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
