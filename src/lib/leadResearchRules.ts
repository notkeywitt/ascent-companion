/**
 * Lead research — the pure half. Types the page and the server share, and the
 * check on what Claude submits. No DB, no Pave, no React.
 *
 * Claude proposes; this module decides what may stand as a proposal:
 *   - A JobTread proposal names a custom field that exists on its target
 *     (customer, location or job), holds one value, and is not on BLOCKED.
 *     Its value must fit the field's type (an option from the list, a number,
 *     a date). The one scalar it may propose is the location's address.
 *   - A proposal equal to what JobTread holds is dropped. One that fills an
 *     empty field is ticked (penciled in). One that would REPLACE a value is
 *     shown unticked, so a person must choose to overwrite.
 *   - Everything else Claude found is a `fact`: the app's own property fields,
 *     grouped by FACT_GROUPS. Facts never reach JobTread.
 */

export type ProposalTarget = "account" | "location" | "job";

export const TARGET_LABEL: Record<ProposalTarget, string> = {
  account: "Customer",
  location: "Address",
  job: "Job",
};

/** The JobTread Files folder that research files go into. */
export const BACKGROUND_FOLDER = "Background";

/** One custom field Claude may fill, as the begin call hands it out. */
export interface FieldDefLite {
  id: string;
  name: string;
  type: string;
  options: string[];
  editable: boolean;
}

export type FieldCatalog = Record<ProposalTarget, FieldDefLite[]>;

/**
 * Field names research never proposes, whatever their target. Status and Lead
 * Source say where a lead stands and came from; Notes holds the intake
 * questionnaire; Phase is the job's lifecycle. A person sets those.
 */
export const BLOCKED_FIELDS = new Set(["status", "lead source", "notes", "phase", "job type"]);

export interface Proposal {
  id: string;
  target: ProposalTarget;
  /** Custom field id, or "" for the location's address scalar. */
  fieldId: string;
  label: string;
  type: string;
  options: string[];
  /** What JobTread held when the run read it. */
  current: string;
  value: string;
  source: string;
  note: string;
  /** Ticked: approve writes it. */
  selected: boolean;
  /** Set by approve. */
  applied?: boolean;
  error?: string;
}

export const FACT_GROUPS = [
  "Parcel",
  "Structures",
  "Permits & inspections",
  "Land & zoning",
  "Water & septic",
  "Utilities & access",
  "Hazards & critical areas",
  "Ownership & sales",
  "Taxes & value",
  "Listing & photos",
  "Fit with the inquiry",
  "Other",
] as const;

export type FactGroup = (typeof FACT_GROUPS)[number];

/** A property field the app keeps for itself. */
export interface Fact {
  id: string;
  group: FactGroup;
  label: string;
  value: string;
  source: string;
}

export interface Permit {
  number: string;
  type: string;
  status: string;
  date: string;
  description: string;
  source: string;
}

export interface ResearchSource {
  name: string;
  url: string;
  reached: boolean;
  note: string;
}

export interface Dossier {
  proposals: Proposal[];
  facts: Fact[];
  permits: Permit[];
  sources: ResearchSource[];
  /** Questions a person should answer, or check on site. */
  openQuestions: string[];
}

export interface MatchInfo {
  confidence: "high" | "medium" | "low";
  parcel: string;
  note: string;
}

export const EMPTY_DOSSIER: Dossier = { proposals: [], facts: [], permits: [], sources: [], openQuestions: [] };

/** File limits. A Vercel request body stops at 4.5 MB, so files go up in chunks. */
export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_RUN_BYTES = 250 * 1024 * 1024;
export const MAX_RUN_FILES = 80;

const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+$/g, "").trim().slice(0, max);
const url = (v: unknown) => {
  const s = str(v, 1000);
  return /^https?:\/\//i.test(s) ? s : "";
};

/** A value coerced to what a field of `type` accepts, or an error. */
export function coerceValue(def: Pick<FieldDefLite, "type" | "options" | "name">, raw: string): { value: string } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: `${def.name}: empty value.` };
  switch (def.type) {
    case "option": {
      const hit = def.options.find((o) => o.toLowerCase() === text.toLowerCase());
      return hit ? { value: hit } : { error: `${def.name}: "${text}" is not one of ${def.options.join(", ")}.` };
    }
    case "number": {
      const n = Number(text.replace(/[,$\s]/g, ""));
      return Number.isFinite(n) ? { value: String(n) } : { error: `${def.name}: "${text}" is not a number.` };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { value: text } : { error: `${def.name}: dates are YYYY-MM-DD.` };
    case "boolean": {
      const t = text.toLowerCase();
      if (t === "true" || t === "yes") return { value: "true" };
      if (t === "false" || t === "no") return { value: "false" };
      return { error: `${def.name}: true or false.` };
    }
    default:
      return { value: text.slice(0, 2000) };
  }
}

/** Same value, ignoring case, spacing and number formatting. */
export function sameValue(a: string, b: string): boolean {
  const norm = (s: string) => {
    const t = s.trim().toLowerCase().replace(/\s+/g, " ");
    const n = Number(t.replace(/[,$]/g, ""));
    return t && Number.isFinite(n) ? String(n) : t;
  };
  return norm(a) === norm(b);
}

export interface CleanContext {
  catalog: FieldCatalog;
  /** What each target holds now, by custom field id. */
  current: Record<ProposalTarget, Record<string, string>>;
  currentAddress: string;
}

export interface CleanResult {
  summary: string;
  match: MatchInfo;
  dossier: Dossier;
  /** Proposals and rows that were dropped, and why. Shown to the reviewer. */
  warnings: string[];
}

function factGroup(v: unknown): FactGroup {
  const s = str(v, 60).toLowerCase();
  return FACT_GROUPS.find((g) => g.toLowerCase() === s) ?? "Other";
}

/** Check Claude's submission. Never throws; a bad row becomes a warning. */
export function cleanSubmission(raw: unknown, ctx: CleanContext): CleanResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const m = (r.match && typeof r.match === "object" ? r.match : {}) as Record<string, unknown>;
  const confidence = ["high", "medium", "low"].includes(String(m.confidence)) ? (String(m.confidence) as MatchInfo["confidence"]) : "low";
  const match: MatchInfo = { confidence, parcel: str(m.parcel, 60), note: str(m.note, 1000) };

  const proposals: Proposal[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(r.proposals) ? r.proposals : [];
  list.forEach((p0, i) => {
    const p = (p0 && typeof p0 === "object" ? p0 : {}) as Record<string, unknown>;
    const target = String(p.target ?? "") as ProposalTarget;
    if (!(target in ctx.catalog)) {
      warnings.push(`Proposal ${i + 1}: unknown target "${String(p.target ?? "")}".`);
      return;
    }
    const value = str(p.value, 2000);
    const source = url(p.source);
    const note = str(p.note, 500);
    const fieldId = str(p.fieldId, 64);
    if (!fieldId) {
      if (target !== "location" || String(p.field ?? "") !== "address") {
        warnings.push(`Proposal ${i + 1}: only the location's address may be proposed without a fieldId.`);
        return;
      }
      if (!value || sameValue(value, ctx.currentAddress)) return;
      if (seen.has("location:address")) return;
      seen.add("location:address");
      proposals.push({
        id: `p${proposals.length + 1}`,
        target,
        fieldId: "",
        label: "Address",
        type: "text",
        options: [],
        current: ctx.currentAddress,
        value,
        source,
        note,
        selected: !ctx.currentAddress.trim(),
      });
      return;
    }
    const def = ctx.catalog[target].find((d) => d.id === fieldId);
    if (!def) {
      warnings.push(`Proposal ${i + 1}: field ${fieldId} is not a ${TARGET_LABEL[target]} field.`);
      return;
    }
    if (!def.editable || BLOCKED_FIELDS.has(def.name.trim().toLowerCase())) {
      warnings.push(`${def.name}: research does not set this field.`);
      return;
    }
    const key = `${target}:${fieldId}`;
    if (seen.has(key)) return;
    const coerced = coerceValue(def, value);
    if ("error" in coerced) {
      warnings.push(coerced.error);
      return;
    }
    const current = ctx.current[target]?.[fieldId] ?? "";
    if (current && sameValue(current, coerced.value)) return;
    seen.add(key);
    proposals.push({
      id: `p${proposals.length + 1}`,
      target,
      fieldId,
      label: def.name,
      type: def.type,
      options: def.options,
      current,
      value: coerced.value,
      source,
      note,
      selected: !current.trim(),
    });
  });

  const facts: Fact[] = (Array.isArray(r.facts) ? r.facts : [])
    .map((f0) => (f0 && typeof f0 === "object" ? f0 : {}) as Record<string, unknown>)
    .map((f) => ({ group: factGroup(f.group), label: str(f.label, 80), value: str(f.value, 2000), source: url(f.source) }))
    .filter((f) => f.label && f.value)
    .slice(0, 250)
    .map((f, i) => ({ id: `f${i + 1}`, ...f }));

  const permits: Permit[] = (Array.isArray(r.permits) ? r.permits : [])
    .map((x0) => (x0 && typeof x0 === "object" ? x0 : {}) as Record<string, unknown>)
    .map((x) => ({
      number: str(x.number, 60),
      type: str(x.type, 120),
      status: str(x.status, 60),
      date: str(x.date, 20),
      description: str(x.description, 1000),
      source: url(x.source),
    }))
    .filter((x) => x.number || x.description)
    .slice(0, 150);

  const sources: ResearchSource[] = (Array.isArray(r.sources) ? r.sources : [])
    .map((x0) => (x0 && typeof x0 === "object" ? x0 : {}) as Record<string, unknown>)
    .map((x) => ({ name: str(x.name, 120), url: url(x.url), reached: x.reached !== false, note: str(x.note, 500) }))
    .filter((x) => x.name || x.url)
    .slice(0, 80);

  const openQuestions = (Array.isArray(r.openQuestions) ? r.openQuestions : [])
    .map((q) => str(q, 500))
    .filter(Boolean)
    .slice(0, 30);

  const summary = str(r.summary, 3000);
  if (!summary) warnings.push("No summary was written.");
  return { summary, match, dossier: { proposals, facts, permits, sources, openQuestions }, warnings };
}

/** Parse a stored dossier. A blank or broken column reads as empty. */
export function readDossier(json: string): Dossier & { warnings?: string[] } {
  try {
    const d = JSON.parse(json || "{}");
    return {
      proposals: Array.isArray(d.proposals) ? d.proposals : [],
      facts: Array.isArray(d.facts) ? d.facts : [],
      permits: Array.isArray(d.permits) ? d.permits : [],
      sources: Array.isArray(d.sources) ? d.sources : [],
      openQuestions: Array.isArray(d.openQuestions) ? d.openQuestions : [],
      warnings: Array.isArray(d.warnings) ? d.warnings : [],
    };
  } catch {
    return { ...EMPTY_DOSSIER };
  }
}

export function readMatch(json: string): MatchInfo {
  try {
    const m = JSON.parse(json || "{}");
    return {
      confidence: ["high", "medium", "low"].includes(m.confidence) ? m.confidence : "low",
      parcel: String(m.parcel ?? ""),
      note: String(m.note ?? ""),
    };
  } catch {
    return { confidence: "low", parcel: "", note: "" };
  }
}

/** One approved write: a target record, and the patch the Clients editor takes. */
export interface TargetPatch {
  target: ProposalTarget;
  fields: Record<string, string>;
  customFieldValues: Record<string, string>;
  proposalIds: string[];
}

/**
 * The reviewer's picks → one patch per target. A pick names a proposal and
 * the value as the reviewer left it (it may be edited). Unknown ids drop out.
 */
export function buildPatches(proposals: Proposal[], picks: { id: string; value: string }[]): TargetPatch[] {
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const out = new Map<ProposalTarget, TargetPatch>();
  for (const pick of picks) {
    const p = byId.get(pick.id);
    if (!p || p.applied) continue;
    const value = String(pick.value ?? "").trim();
    if (!value) continue;
    const patch = out.get(p.target) ?? { target: p.target, fields: {}, customFieldValues: {}, proposalIds: [] };
    if (p.fieldId) patch.customFieldValues[p.fieldId] = value;
    else patch.fields.address = value;
    patch.proposalIds.push(p.id);
    out.set(p.target, patch);
  }
  return [...out.values()];
}

/** A file name JobTread and a Mac both accept. */
export function safeFileName(name: string): string {
  const s = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return s || "file";
}
