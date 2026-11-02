/**
 * Vendor COIs — the names Apps Script files them under (ascent-appscript
 * VendorCoi.js): "<Vendor> COI - <year>", the vendor name with the characters
 * Drive refuses spaced out.
 */

/** A vendor name as VendorCoi.js `_vcoiName` writes it, lower-cased to match on. */
export function coiKey(vendor: string): string {
  return vendor
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** File names → each vendor's newest COI year, keyed by `coiKey`. */
export function coiByVendor(fileNames: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of fileNames) {
    const m = name.match(/^(.+?) COI - (\d{4})\b/);
    if (!m) continue;
    const key = coiKey(m[1]);
    const year = Number(m[2]);
    if (!(out[key] >= year)) out[key] = year;
  }
  return out;
}
