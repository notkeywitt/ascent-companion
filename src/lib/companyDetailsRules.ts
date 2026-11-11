/**
 * Ascent's own details — the pure half (no DB), safe in a client component.
 * The store is src/lib/companyDetails.ts.
 */

export type DetailKey = "tax" | "po" | "ubi" | "reseller_permit" | "contractor_license";

export interface DetailField {
  key: DetailKey;
  label: string;
  /** A rate is stored as a decimal ("0.0835") and typed as a percent ("8.35"). */
  kind: "rate" | "text";
}

export const DETAIL_FIELDS: DetailField[] = [
  { key: "tax", label: "Tax", kind: "rate" },
  { key: "po", label: "P&O", kind: "rate" },
  { key: "ubi", label: "UBI", kind: "text" },
  { key: "reseller_permit", label: "Reseller Permit", kind: "text" },
  { key: "contractor_license", label: "Contractor License", kind: "text" },
];

export type DetailValues = Record<DetailKey, string>;

export const EMPTY_DETAILS: DetailValues = {
  tax: "",
  po: "",
  ubi: "",
  reseller_permit: "",
  contractor_license: "",
};

/** "0.0835" → "8.35". Not a plain number → returned as is. "" → "". */
export function rateToPercentText(stored: string): string {
  const raw = stored.trim();
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) return raw;
  return String(+(n * 100).toFixed(4));
}

/** "8.35" or "8.35%" → "0.0835". Null when it is not a percent from 0 to 100. */
export function percentTextToRate(typed: string): string | null {
  const raw = typed.trim().replace(/%$/, "").trim();
  if (raw === "") return "";
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (n > 100) return null;
  return String(+(n / 100).toFixed(6));
}

/** "0.0835" → "8.35%" for display. */
export function rateLabel(stored: string): string {
  const t = rateToPercentText(stored);
  return t === "" || !Number.isFinite(Number(t)) ? t : `${t}%`;
}

/**
 * An edit from the browser, cleaned: only known keys, rates as decimals, text
 * trimmed and capped. Returns the cleaned values and the first problem, if any.
 * `input` holds what the person typed (a rate as a percent).
 */
export function cleanDetailsInput(input: unknown): { values: Partial<DetailValues>; error?: string } {
  const values: Partial<DetailValues> = {};
  if (!input || typeof input !== "object") return { values, error: "Send the details as an object." };
  const src = input as Record<string, unknown>;
  for (const f of DETAIL_FIELDS) {
    if (src[f.key] === undefined) continue;
    const typed = String(src[f.key] ?? "").trim();
    if (f.kind === "rate") {
      const rate = percentTextToRate(typed);
      if (rate === null) return { values, error: `${f.label} must be a percent from 0 to 100.` };
      values[f.key] = rate;
    } else {
      if (typed.length > 60) return { values, error: `${f.label} is over 60 characters.` };
      values[f.key] = typed;
    }
  }
  return { values };
}

/** What kinds of file the documents card takes, and the size cap (Vercel's body limit is 4.5 MB). */
export const DOC_MAX_BYTES = 4 * 1024 * 1024;
export const DOC_MIME = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];

export function docProblem(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return "That file is empty.";
  if (file.size > DOC_MAX_BYTES) return "The file is over 4 MB.";
  if (!DOC_MIME.includes(file.type)) return "Use a PDF or a photo (JPG, PNG, HEIC, WebP).";
  return null;
}
