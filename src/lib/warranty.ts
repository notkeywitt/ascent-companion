/**
 * Warranty work — Ascent's own cost, never billed to the client.
 *
 * Bills and time coded 88 90 00 stay OUT of every per-job figure: TO BE
 * INVOICED, a job's month total, its cost rings. They stay IN the all-jobs
 * month totals, as a "Warranty Work" slice of their own.
 *
 * KEEP IN SYNC with TRACKING_WARRANTY_CSI in ascent-appscript/TrackingSheets.js,
 * which applies the same rule to the tracking sheets and the Invoicing Package.
 */

/** The cost code for warranty work (JT cost code 22PgDDHtNfu8 "Warranty Work"). */
export const WARRANTY_CSI = "88 90 00";

/** The all-jobs rings' slice key for warranty work. Never a job id. */
export const WARRANTY_SLICE_KEY = "__warranty";
