/**
 * The new-lead intake form — the Companion's copy of the public inquiry form at
 * ascentbuildingco.com/new-inquiry.
 *
 * WHY IT EXISTS: the website form emails a submission to the office, and someone
 * turns that into a JobTread customer by hand. Plenty of leads never touch the
 * website at all — they phone, they stop by, they come through Casey. Those had
 * nowhere to live until a JobTread customer existed for them. This module is the
 * question set, so a lead can be logged in the Companion FIRST (no JobTread
 * account, no write anywhere) and pushed to JobTread later, once it's real.
 *
 * PURE MODULE — constants, types and string formatting only. No DB, no Pave, no
 * React, so the client form and the API route share one definition of "what the
 * questions are" and can never drift apart.
 *
 * WHERE THE QUESTIONS COME FROM: the live form's own submission emails
 * (Squarespace "Form Submission - Contact(WIP) Form 3 2 3", read 2026-08-11).
 * The FIELDS and their labels below are verbatim from those emails. The choice
 * OPTIONS are only partly confirmed that way — a submission shows what someone
 * picked, not the whole menu — so each list below marks which values were seen
 * live and which are filled in. Editing a list here is the only change needed to
 * match the website; the answers are stored as text, so a changed option never
 * invalidates a lead already logged.
 */

/** One logged inquiry — every answer, as typed. Dates are YYYY-MM-DD. */
export interface InquiryFields {
  /** The lead's name. Becomes the JobTread customer (account) name on push. */
  name: string;
  email: string;
  phone: string;
  contactMethod: string;
  residency: string;
  /** The website form calls this "Project Location" — address or parcel. */
  address: string;
  /** Multi-select, stored comma-joined ("New Build, Consultation"). */
  services: string;
  projectDetails: string;
  designStatus: string;
  /** Multi-select, stored comma-joined ("Under $250k, $250k - $750k"). */
  budget: string;
  startDate: string;
  targetDate: string;
  /** JobTread's customer "Lead Source" — not on the website form (a web
   *  submission is always "Website"), but the whole point of a phoned-in lead. */
  leadSource: string;
  /** JobTread's customer "Type". */
  customerType: string;
  /** Our own intake notes — never part of the customer's answers. */
  notes: string;
}

export const BLANK_INQUIRY: InquiryFields = {
  name: "",
  email: "",
  phone: "",
  contactMethod: "",
  residency: "",
  address: "",
  services: "",
  projectDetails: "",
  designStatus: "",
  budget: "",
  startDate: "",
  targetDate: "",
  leadSource: "",
  customerType: "",
  notes: "",
};

/* ----------------------------------------------------------------- options */

/** Seen live: "Phone", "Text". "Email" completes the set. */
export const CONTACT_METHODS = ["Phone", "Text", "Email"] as const;

/** Seen live: "Full-time", "Part-time". */
export const RESIDENCY = ["Full-time", "Part-time", "Not a resident"] as const;

/** Seen live: "New Build", "Consultation". The rest mirror JobTread's own
 *  job-type list, which is what these turn into once a lead becomes a job. */
export const SERVICES = [
  "New Build",
  "Addition",
  "Remodel",
  "Maintenance / Repair",
  "Electrical",
  "Consultation",
] as const;

/** Seen live: "Under $250k", "$250k - $750k" (and picked in combination — the
 *  website field is multi-select, so this one is too). */
export const BUDGETS = ["Under $250k", "$250k - $750k", "$750k - $1.5M", "Over $1.5M"] as const;

/**
 * JobTread's OWN option lists for the two customer fields we write on push
 * (org 22PXG7QcMaQ2, read live 2026-08-11). These are not free text: JobTread
 * rejects a value that isn't in its list, so keep them exact.
 */
export const JT_LEAD_SOURCES = [
  "Website",
  "Casey",
  "Referral",
  "Instagram",
  "Internet Search",
] as const;
export const JT_CUSTOMER_TYPES = ["Residential", "Commercial", "Other"] as const;

/* ------------------------------------------------------------ display rows */

/**
 * The customer's answers, in the website form's order, with its labels verbatim.
 * Drives BOTH the read-back panel on the leads page and the summary pushed into
 * JobTread — one list, so the two can't disagree.
 *
 * `name`, `leadSource`, `customerType` and `notes` are deliberately absent: the
 * first three become real JobTread fields on push, and `notes` is ours.
 */
export const INQUIRY_ROWS: { key: keyof InquiryFields; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "contactMethod", label: "Preferred Contact Method" },
  { key: "residency", label: "Residency" },
  { key: "address", label: "Project Location" },
  { key: "services", label: "What services are you interested in?" },
  { key: "projectDetails", label: "Project Details" },
  { key: "designStatus", label: "Design Status" },
  { key: "budget", label: "Project Budget" },
  { key: "startDate", label: "Start Date" },
  { key: "targetDate", label: "Target Completion Date" },
];

/* -------------------------------------------------------------- normalizing */

/** Split a comma-joined multi-select back into its values. */
export function splitMulti(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Join a multi-select for storage, the way the website's emails render it. */
export function joinMulti(values: readonly string[]): string {
  return values.filter(Boolean).join(", ");
}

/** Toggle one value in a comma-joined multi-select, preserving `order`. */
export function toggleMulti(value: string, option: string, order: readonly string[]): string {
  const on = new Set(splitMulti(value));
  if (on.has(option)) on.delete(option);
  else on.add(option);
  return joinMulti(order.filter((o) => on.has(o)));
}

/**
 * Coerce an untrusted request body into InquiryFields. Every key is optional and
 * anything absent stays "" — the ONLY required answer is a name (checked by the
 * caller), because an intake call can end with nothing else known yet.
 *
 * `present` reports which keys the body actually carried, so a PATCH can write
 * just those and not blank the answers it never sent.
 */
export function normalizeInquiry(body: Record<string, unknown>): {
  fields: InquiryFields;
  present: (keyof InquiryFields)[];
} {
  const fields = { ...BLANK_INQUIRY };
  const present: (keyof InquiryFields)[] = [];
  for (const key of Object.keys(BLANK_INQUIRY) as (keyof InquiryFields)[]) {
    if (body[key] === undefined) continue;
    present.push(key);
    const raw = body[key];
    fields[key] = Array.isArray(raw)
      ? joinMulti(raw.map((v) => String(v ?? "").trim()))
      : String(raw ?? "").trim();
  }
  return { fields, present };
}

/* ----------------------------------------------------------------- summary */

/**
 * The intake answers as one block of text, for JobTread's customer "Notes"
 * field — the only place in JobTread that can hold them (it has no inquiry
 * object, and adding custom fields for twelve questions would be a schema change
 * the owner didn't ask for). Empty answers are skipped, so a thin intake call
 * pushes a short note rather than a wall of blank labels.
 */
export function inquirySummary(
  fields: InquiryFields,
  meta: { loggedAt?: string; loggedBy?: string } = {},
): string {
  const lines: string[] = ["Inquiry (logged in Ascent Assistant)"];
  const stamp = [meta.loggedAt?.slice(0, 10), meta.loggedBy].filter(Boolean).join(" · ");
  if (stamp) lines.push(stamp);
  lines.push("");
  for (const row of INQUIRY_ROWS) {
    const value = fields[row.key];
    if (!value) continue;
    // Multi-line answers (Project Details, Design Status) read better broken out
    // under their label than run onto it.
    lines.push(value.includes("\n") ? `${row.label}:\n${value}` : `${row.label}: ${value}`);
  }
  if (fields.notes) lines.push("", `Our notes: ${fields.notes}`);
  return lines.join("\n");
}
