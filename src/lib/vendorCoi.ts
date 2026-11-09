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

/*
 * ── COI requests (owner, 2026-11-09) ───────────────────────────────────────
 * The Vendors page records when a vendor's COI expires (JobTread's "COI
 * Expires" vendor field) and when a COI was last requested (companion table
 * `vendor_coi`). Its "Request COIs" button opens one Gmail compose window,
 * BCC'd to every vendor that needs a new certificate.
 *
 * Who is asked: a vendor billed in the past 365 days (a void bill does not
 * count) whose COI has expired or has no expiry recorded — unless the vendor
 * does not need a COI. A vendor needs none when the office set it to "No", or,
 * left on "Auto", when JobTread's Type field says Supplier, Rentals or Other,
 * or its name is on `COI_EXEMPT_NAMES`. "Yes" overrides both.
 */

/**
 * Vendors that never carry a COI for Ascent: stores, online suppliers,
 * software, utilities, insurers, food, and internal accounts. Matched on
 * `coiKey`. Built from every vendor billed Nov 2025 – Nov 2026. A vendor
 * missing from this list is set on its own card ("COI needed: No").
 */
export const COI_EXEMPT_NAMES: readonly string[] = [
  // Stores and suppliers
  "amazon",
  "home depot",
  "lowe's",
  "costco",
  "sunset builders supply",
  "fasteners plus",
  "fmw fasteners",
  "star fasteners",
  "dk hardware supply",
  "builders hardware and supply",
  "builders stainless",
  "ferguson home",
  "factorydirectsupply",
  "ereplacementparts.com",
  "etrailer",
  "kreg",
  "myknobs.com",
  "rejuvenation",
  "reggio register",
  "architectural grille",
  "protective products",
  "polymer industries",
  "hvacquick",
  "desky",
  "printpps",
  "shelterlogic direct",
  "daltile",
  // Software, services, utilities, government
  "anthropic",
  "google",
  "apple",
  "vercel",
  "1password",
  "qb time",
  "opalco",
  "lswdd",
  "epermits",
  "sjba",
  "usps",
  "san juan county solid waste",
  "sjfd4",
  "books by sara",
  // Insurers
  "rli",
  "state farm",
  "progressive",
  // Food, groceries, wellness
  "isabells coffee",
  "counter culture",
  "superlost coffee roasters",
  "olympia coffee",
  "blossom grocery",
  "lopez village market",
  "lopez grind",
  "firebug foods llc",
  "vitality yoga therapy",
  "paper scissors on the rocks",
  // Internal accounts
  "ascent - electrical",
  "historical job cost",
  "a1 old",
  "keillor witt",
];

const EXEMPT = new Set(COI_EXEMPT_NAMES);

/** JobTread "Type" values that never need a COI. */
const EXEMPT_TYPES = new Set(["supplier", "rentals", "other"]);

/**
 * Does this vendor need a COI? `override` is the office's choice on the vendor
 * card: true = yes, false = no, null = decide from type and name.
 */
export function coiNeeded(vendor: string, vendorType: string, override: boolean | null): boolean {
  if (override !== null) return override;
  if (EXEMPT_TYPES.has(vendorType.trim().toLowerCase())) return false;
  return !EXEMPT.has(coiKey(vendor));
}

export type CoiState = "current" | "expiring" | "expired" | "unknown";

/** Days before expiry that a COI shows as "expiring". */
export const COI_EXPIRING_DAYS = 30;

/**
 * Where a COI stands on `todayIso` ("YYYY-MM-DD"). A COI is good THROUGH its
 * expiry date, so it is expired from the day after.
 */
export function coiState(expires: string, todayIso: string): CoiState {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return "unknown";
  if (expires < todayIso) return "expired";
  const soon = new Date(todayIso + "T00:00:00Z");
  soon.setUTCDate(soon.getUTCDate() + COI_EXPIRING_DAYS);
  return expires <= soon.toISOString().slice(0, 10) ? "expiring" : "current";
}

/** One vendor as the COI request reads it. */
export interface CoiVendorInput {
  id: string;
  name: string;
  vendorType: string;
  coiExpires: string;
  override: boolean | null;
  /** Newest non-void bill's issue date, "YYYY-MM-DD", or "". */
  lastBillOn: string;
  /** Addresses from the vendor's JobTread Email field. */
  emails: string[];
}

/** One vendor's COI state, as /api/vendor-coi/status returns it. */
export interface VendorCoiRow extends CoiVendorInput {
  /** "YYYY-MM-DD" of the last COI request, or "". */
  lastRequestedOn: string;
  needed: boolean;
  state: CoiState;
}

/** The date 365 days before `todayIso`. A bill on or after it counts. */
export function billedSince(todayIso: string): string {
  const d = new Date(todayIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 365);
  return d.toISOString().slice(0, 10);
}

/**
 * The vendors a COI request goes to: billed in the past year, needing a COI,
 * and expired or with no expiry recorded. A–Z.
 */
export function coiRequestList(vendors: CoiVendorInput[], todayIso: string): CoiVendorInput[] {
  const since = billedSince(todayIso);
  return vendors
    .filter((v) => v.lastBillOn >= since && v.lastBillOn !== "")
    .filter((v) => coiNeeded(v.name, v.vendorType, v.override))
    .filter((v) => {
      const s = coiState(v.coiExpires, todayIso);
      return s === "expired" || s === "unknown";
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const COI_REQUEST_SUBJECT = "Certificate of Insurance Request - Ascent Building Co.";

/** The Oct 23, 2026 request's wording. */
export const COI_REQUEST_BODY = `Hi,

We're updating our subcontractor insurance records as part of our annual general liability audit, and we'd be grateful if you could send us a current Certificate of Liability Insurance to office@ascentbuildingco.com.

If you've already sent us a certificate recently, thank you, and feel free to disregard this. Please reach out with any questions.

Thanks so much

-Keillor

Office & Administration
Ascent Building Co. LLC
PO Box 664
Lopez Island, WA 98261
(360) 209 4033`;

export const OFFICE_EMAIL = "office@ascentbuildingco.com";

/**
 * A Gmail compose link in the office account: To the office, every vendor in
 * BCC so no vendor sees another's address. Gmail saves it as a draft.
 */
export function gmailComposeUrl(bcc: string[]): string {
  const p = new URLSearchParams({
    authuser: OFFICE_EMAIL,
    view: "cm",
    fs: "1",
    to: OFFICE_EMAIL,
    bcc: [...new Set(bcc.map((a) => a.trim().toLowerCase()).filter(Boolean))].join(","),
    su: COI_REQUEST_SUBJECT,
    body: COI_REQUEST_BODY,
  });
  return `https://mail.google.com/mail/?${p.toString()}`;
}

/**
 * The Oct 23, 2026 mass request, by JobTread account id — the first row in
 * `vendor_coi` for each vendor it reached. 35 of its 36 addresses matched a
 * vendor; randy.champagne@gmail.com matched none.
 */
export const COI_REQUEST_SEED = {
  on: "2026-10-23",
  accountIds: [
    "22PY6FZiXGnA", // A & A Well Drilling
    "22PXYbsFzcyP", // A&G Active Insulation
    "22PXYcKZSMFX", // A1 Welding Incorporated
    "22PaFiTUgAXZ", // Absolute Asbestos
    "22PXYc5w5ETG", // AC Contracting Services
    "22PcLbSJmDDX", // Affordable Abatement
    "22PXYc9PybLB", // BRX
    "22PXYc9GAxpt", // Bison Brothers Concrete
    "22PZhaLrdbtg", // Cascade Roofing
    "22PZi26HBuuw", // Dan's Custom Masonry
    "22PXYcC6wSaw", // Det Spec Drywall
    "22PXYcCBWg54", // Dirt Doctors
    "22PXYcCSSZ6B", // Element Smart Roofing
    "22PXYcChesFW", // Flower Mountain Tree Service
    "22PXYcD8snU4", // Havelbuilt
    "22PXYcDRXY2R", // Island Custom Woodworks
    "22PXYcDXnpvN", // JBM Home Services
    "22PXYcDgJ3BF", // JR Granite & Tile
    "22PXYcE7MJRe", // Madrona Paint Works
    "22PXYcEPTF2j", // Mt. Baker Overhead Garage Doors
    "22PbQzk86Fug", // Naturally Sustained
    "22PXYcEfUuNm", // Pacific Rim Insulation
    "22PXYcEqzzfS", // Preferred Plumbing
    "22PXYcExddiT", // Rendon Home Services
    "22PZhfV2G6ME", // Sage
    "22PYm36LU3KG", // Screaming Arrow Construction
    "22PXYcGtpTcG", // Scrivanich Natural Stone
    "22PXYcGvtu4M", // Sea Glass Window Washing
    "22PXYcGyYyP3", // Seamlessly Gutters
    "22PXYcJv2qCX", // Woodhaven
    "22PZepf5kk3Q", // Osprey
    "22PXYcEFGQHA", // Mighty Tidy
    "22PXYcEM8eH8", // Montello Designs
    "22PaYCEQRkzw", // North Star Drywall
    "22PXYcKXMEHQ", // Pounders Construction
  ],
} as const;
