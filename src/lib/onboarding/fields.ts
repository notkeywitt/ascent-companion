/**
 * New-hire paperwork — how a fillable PDF's fields become a form on a phone.
 *
 * PURE: no PDF library, no DB, no session, so `fields.test.ts` can pin it.
 * `pdf.ts` reads the raw fields out of a PDF and hands them here; the office
 * editor (`src/app/onboarding/office/FormEditor.tsx`) adjusts the result.
 *
 * ## The model
 *
 * Every field the PDF carries gets ONE config row. `role` says who fills it:
 *
 *   employee  the new hire fills it on /onboarding (pre-filled from the
 *             profile where `prefill` names a profile value).
 *   office    left blank and still fillable in the saved PDF — the I-9's
 *             Section 2, the W-4's "Employers only" box.
 *   fixed     the office's own constant (`value`) — e.g. the company name.
 *   hidden    not shown and not filled.
 *
 * Separate checkboxes that mean "pick one" (Checking / Savings) share a
 * `group`; the phone shows them as one choice and the fill ticks exactly one.
 *
 * `guessField` is only a FIRST GUESS from the field's name and tooltip. The
 * office editor is where it is made right, and a form whose PDF fields are
 * already known gets a preset (`presetFor`).
 */

export type FieldKind = "text" | "check" | "choice" | "signature";
export type FieldRole = "employee" | "office" | "fixed" | "hidden";

/** A profile value a field can be pre-filled from. */
export type PrefillKey =
  | "firstName"
  | "middleInitial"
  | "firstMi"
  | "lastName"
  | "fullName"
  | "street"
  | "apt"
  | "city"
  | "state"
  | "zip"
  | "cityStateZip"
  | "address"
  | "phone"
  | "email"
  | "birthday"
  | "ssn"
  | "today";

export const PREFILL_LABELS: Record<PrefillKey, string> = {
  firstName: "First name",
  middleInitial: "Middle initial",
  firstMi: "First name + middle initial",
  lastName: "Last name",
  fullName: "Full name",
  street: "Street address",
  apt: "Apt / unit",
  city: "City",
  state: "State",
  zip: "ZIP",
  cityStateZip: "City, state, ZIP",
  address: "Full address",
  phone: "Phone",
  email: "Email",
  birthday: "Date of birth",
  ssn: "Social Security number",
  today: "Today's date",
};

/** One field of a PDF as the PDF reader found it — before any guess. */
export interface RawField {
  name: string;
  tooltip: string;
  kind: FieldKind | "skip";
  /** 0-based page of the field's first widget. */
  page: number;
  /** Choice fields: the values the PDF accepts. */
  options?: string[];
  maxLength?: number;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  name: string;
  kind: FieldKind;
  label: string;
  role: FieldRole;
  page: number;
  prefill?: PrefillKey;
  /** `fixed` fields: the constant the office set. */
  value?: string;
  required?: boolean;
  /** `choice` fields. */
  options?: FieldOption[];
  /** `check` fields that are one answer between them (see the header). */
  group?: string;
  maxLength?: number;
  /**
   * A signature spot the PDF has no field for: where on `page` to paint the
   * drawn signature, in PDF points. Only a preset adds one.
   */
  box?: { x: number; y: number; width: number; height: number };
}

/** What the new hire told the profile step — the source of every prefill. */
export interface Profile {
  firstName: string;
  middleInitial: string;
  lastName: string;
  street: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  /** YYYY-MM-DD, from a date input. */
  birthday: string;
  dl: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
}

export const EMPTY_PROFILE: Profile = {
  firstName: "",
  middleInitial: "",
  lastName: "",
  street: "",
  apt: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  email: "",
  birthday: "",
  dl: "",
  emergencyName: "",
  emergencyRelation: "",
  emergencyPhone: "",
};

/** Keep only the known keys, as trimmed strings. */
export function cleanProfile(v: unknown): Profile {
  const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = { ...EMPTY_PROFILE };
  for (const k of Object.keys(out) as (keyof Profile)[]) {
    const x = src[k];
    out[k] = typeof x === "string" ? x.trim().slice(0, 200) : "";
  }
  out.state = out.state.toUpperCase().slice(0, 2);
  out.middleInitial = out.middleInitial.replace(/\.$/, "").slice(0, 1).toUpperCase();
  return out;
}

/** The profile fields the new hire must give before the forms open. */
export const PROFILE_REQUIRED: (keyof Profile)[] = [
  "firstName",
  "lastName",
  "street",
  "city",
  "state",
  "zip",
  "phone",
  "birthday",
];

export function profileMissing(p: Profile): (keyof Profile)[] {
  return PROFILE_REQUIRED.filter((k) => !p[k]);
}

/** "2026-10-19" → "10/19/2026" — the format every federal form asks for. */
export function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** An ISO timestamp or date as "Oct 19, 2026" — the app's one date format. */
export function shortDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The roster's one Address cell: "12 Main St Apt 3, Friday Harbor, WA 98250". */
export function rosterAddress(p: Profile): string {
  const street = [p.street, p.apt].filter(Boolean).join(" ");
  const tail = [p.state, p.zip].filter(Boolean).join(" ");
  return [street, p.city, tail].filter(Boolean).join(", ");
}

/**
 * Every prefill value for one profile. `ssn` is never in the profile — the
 * page passes it from browser memory, so it is never stored.
 */
export function prefillValues(p: Profile, today: string, ssn = ""): Record<PrefillKey, string> {
  const mi = p.middleInitial ? `${p.middleInitial}.` : "";
  return {
    firstName: p.firstName,
    middleInitial: p.middleInitial,
    firstMi: [p.firstName, mi].filter(Boolean).join(" "),
    lastName: p.lastName,
    fullName: [p.firstName, mi, p.lastName].filter(Boolean).join(" "),
    street: [p.street, p.apt].filter(Boolean).join(" "),
    apt: p.apt,
    city: p.city,
    state: p.state,
    zip: p.zip,
    cityStateZip: [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    address: rosterAddress(p),
    phone: p.phone,
    email: p.email,
    birthday: usDate(p.birthday),
    ssn,
    today: usDate(today),
  };
}

/* ------------------------------------------------------------- the guess */

// Section 2 of the I-9, its supplements, and the W-4's "Employers only" box:
// the office fills these after looking at the new hire's documents.
const OFFICE_RE =
  /employer|employers only|section 2|supplement|preparer|translator|reverif|rehire|document title|issuing authority|document number|first (day|date) of employment|first ?day ?employed|\(ein\)|\bein\b|authorized representative|alternative procedure|additional information|office use|list [abc]\b/i;

function guessPrefill(t: string): PrefillKey | undefined {
  if (/social security|\bssn\b/.test(t)) return "ssn";
  if (/birth|\bdob\b/.test(t)) return "birthday";
  if (/today|date signed|signature date|^date$/.test(t)) return "today";
  if (/e-?mail/.test(t)) return "email";
  if (/phone|telephone/.test(t)) return "phone";
  if (/first name and middle initial/.test(t)) return "firstMi";
  if (/other last names/.test(t)) return undefined;
  if (/last name|family name|surname/.test(t)) return "lastName";
  if (/first name|given name/.test(t)) return "firstName";
  if (/middle initial/.test(t)) return "middleInitial";
  if (/city.*state.*zip|city or town, state/.test(t)) return "cityStateZip";
  if (/\bapt\b|apartment/.test(t)) return "apt";
  if (/zip/.test(t)) return "zip";
  if (/city|town/.test(t)) return "city";
  if (/^state\b|\bstate$/.test(t)) return "state";
  if (/street|address/.test(t)) return "street";
  if (/^name$|full name|employee name|^print name/.test(t)) return "fullName";
  return undefined;
}

/** A readable label: the tooltip when the PDF has one, else the field name tidied. */
export function labelFor(raw: Pick<RawField, "name" | "tooltip">): string {
  const tip = raw.tooltip.replace(/\s+/g, " ").trim();
  if (tip && !/^undefined$/i.test(tip)) return tip.length > 140 ? `${tip.slice(0, 137)}…` : tip;
  const leaf = raw.name.split(".").pop() ?? raw.name;
  return leaf.replace(/\[\d+\]/g, "").replace(/[_]+/g, " ").trim() || raw.name;
}

export function guessField(raw: RawField): FieldConfig | null {
  if (raw.kind === "skip") return null;
  const label = labelFor(raw);
  const t = `${raw.tooltip} ${raw.name}`.toLowerCase().replace(/\s+/g, " ").trim();
  const office = OFFICE_RE.test(t);
  let kind: FieldKind = raw.kind;
  if (kind === "text" && /signature/.test(t)) kind = "signature";
  const cfg: FieldConfig = {
    name: raw.name,
    kind,
    label,
    role: office ? "office" : "employee",
    page: raw.page,
  };
  if (raw.maxLength) cfg.maxLength = raw.maxLength;
  if (raw.options?.length) cfg.options = raw.options.map((o) => ({ value: o, label: o }));
  if (kind === "text" && !office) {
    // The tooltip alone, so a long field name cannot outvote what the form says.
    const p = guessPrefill(raw.tooltip.toLowerCase().trim()) ?? guessPrefill(t);
    if (p) cfg.prefill = p;
  }
  // A state dropdown (the I-9 has one) can take the profile's state too.
  if (kind === "choice" && !office && /\bstate\b/.test(t) && raw.options?.length) cfg.prefill = "state";
  if (kind === "signature" && !office) cfg.required = true;
  return cfg;
}

/* -------------------------------------------------------------- presets */

/**
 * Field setups for PDFs whose fields are already known, matched on the field
 * names. The office's own Direct Deposit form names its fields "1", "2",
 * "undefined" and so on, so a guess from those names is useless.
 */
const PRESETS: {
  id: string;
  match: string[];
  fields: Record<string, Partial<FieldConfig>>;
  /** Signature spots the PDF has no field for (see FieldConfig.box). */
  extra?: FieldConfig[];
}[] = [
  {
    id: "direct-deposit",
    match: ["9Digit Routing", "Name of Bank 1", "Entire Paycheck"],
    fields: {
      "1": { label: "Name", prefill: "fullName", required: true },
      "2": { label: "Address", prefill: "street", required: true },
      "City State Zip": { label: "City, state, ZIP", prefill: "cityStateZip", required: true },
      "Name of Bank 1": { label: "Name of bank", required: true },
      "Name of Bank 2": { label: "Account number", required: true },
      "9Digit Routing": { label: "9-digit routing number", required: true, maxLength: 9 },
      "undefined_2.0": { kind: "check", label: "A dollar amount", group: "How much to deposit" },
      "undefined_2.1": { kind: "check", label: "A percent of my pay", group: "How much to deposit" },
      "Entire Paycheck": { kind: "check", label: "My entire paycheck", group: "How much to deposit" },
      undefined: { label: "Dollar amount ($) — only for a dollar amount" },
      or: { label: "Percent (%) — only for a percent" },
      Checking: { kind: "check", label: "Checking", group: "Type of account" },
      Savings: { kind: "check", label: "Savings", group: "Type of account" },
      "the account listed above This authorization will remain in effect until I modify or cancel it in": {
        label: "Company name",
        role: "fixed",
        value: "Ascent Building Co.",
        prefill: undefined,
      },
      undefined_3: { label: "Date", prefill: "today" },
    },
    // "Employee's Signature: ____" is a printed line with no field on it.
    extra: [
      {
        name: "@signature",
        kind: "signature",
        label: "Employee's signature",
        role: "employee",
        page: 0,
        required: true,
        box: { x: 186, y: 94, width: 320, height: 22 },
      },
    ],
  },
];

/** Guess every field, then lay a known form's preset over the guesses. */
export function configFor(raws: RawField[]): FieldConfig[] {
  const guessed = raws.map(guessField).filter((f): f is FieldConfig => f !== null);
  const names = new Set(guessed.map((f) => f.name));
  const preset = PRESETS.find((p) => p.match.every((n) => names.has(n)));
  if (!preset) return guessed;
  const laid = guessed.map((f) => {
    const over = preset.fields[f.name];
    if (!over) return f;
    const next: FieldConfig = { ...f, ...over };
    if ("prefill" in over && over.prefill === undefined) delete next.prefill;
    return next;
  });
  return [...laid, ...(preset.extra ?? [])];
}

/* --------------------------------------------------- what the phone shows */

/** One question on the phone: a single field, or a pick-one group of checkboxes. */
export type Question =
  | { type: "field"; field: FieldConfig }
  | { type: "group"; title: string; members: FieldConfig[] };

/** The employee's questions, in PDF order, with each group gathered at its first member. */
export function questionsFor(fields: FieldConfig[]): Question[] {
  const out: Question[] = [];
  const groups = new Map<string, FieldConfig[]>();
  for (const f of fields) {
    if (f.role !== "employee" || f.kind === "signature") continue;
    if (f.kind === "check" && f.group) {
      const g = groups.get(f.group);
      if (g) g.push(f);
      else {
        const members = [f];
        groups.set(f.group, members);
        out.push({ type: "group", title: f.group, members });
      }
      continue;
    }
    out.push({ type: "field", field: f });
  }
  return out;
}

/** Answers keyed by field name; a group's answer is keyed by `group:<title>`. */
export type Answers = Record<string, string | boolean>;

export const groupKey = (title: string) => `group:${title}`;

/**
 * Which required answers are missing. A signature is checked by the caller,
 * which holds the drawn image.
 */
export function missingAnswers(fields: FieldConfig[], answers: Answers): string[] {
  const missing: string[] = [];
  for (const q of questionsFor(fields)) {
    if (q.type === "group") {
      if (q.members.some((m) => m.required) && !answers[groupKey(q.title)]) missing.push(q.title);
      continue;
    }
    const f = q.field;
    if (!f.required || f.prefill === "today") continue;
    const v = answers[f.name];
    if (f.kind === "check" ? v !== true : !String(v ?? "").trim()) missing.push(f.label);
  }
  return missing;
}

/** Does the form have a signature spot of its own? (If not, the record page carries it.) */
export function hasSignatureField(fields: FieldConfig[]): boolean {
  return fields.some((f) => f.kind === "signature" && f.role === "employee");
}

/** Normalise a config the office editor sent back — never trust its shape. */
export function cleanConfig(v: unknown, known: FieldConfig[]): FieldConfig[] {
  const byName = new Map(known.map((f) => [f.name, f]));
  const src = Array.isArray(v) ? v : [];
  const out: FieldConfig[] = [];
  const roles: FieldRole[] = ["employee", "office", "fixed", "hidden"];
  for (const item of src) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const base = byName.get(String(r.name ?? ""));
    if (!base) continue; // a field the PDF does not have
    const next: FieldConfig = { ...base };
    if (typeof r.label === "string" && r.label.trim()) next.label = r.label.trim().slice(0, 200);
    if (roles.includes(r.role as FieldRole)) next.role = r.role as FieldRole;
    const kinds: FieldKind[] = base.kind === "text" ? ["text", "signature"] : [base.kind];
    if (kinds.includes(r.kind as FieldKind)) next.kind = r.kind as FieldKind;
    if (typeof r.prefill === "string" && r.prefill in PREFILL_LABELS) next.prefill = r.prefill as PrefillKey;
    else delete next.prefill;
    if (typeof r.value === "string") next.value = r.value.slice(0, 500);
    else delete next.value;
    next.required = r.required === true;
    if (typeof r.group === "string" && r.group.trim() && base.kind === "check") next.group = r.group.trim().slice(0, 80);
    else delete next.group;
    if (Array.isArray(r.options) && base.options) {
      const labels = new Map(
        (r.options as unknown[])
          .filter((o): o is { value: string; label: string } => !!o && typeof o === "object")
          .map((o) => [String(o.value), String(o.label ?? "").slice(0, 120)]),
      );
      next.options = base.options.map((o) => ({ value: o.value, label: labels.get(o.value) || o.label }));
    }
    out.push(next);
    byName.delete(next.name);
  }
  // A field the editor left out keeps its stored setup.
  for (const f of byName.values()) out.push(f);
  const order = new Map(known.map((f, i) => [f.name, i]));
  return out.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
}
