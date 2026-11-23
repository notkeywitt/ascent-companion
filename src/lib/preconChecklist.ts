/**
 * A job's Preconstruction Checklist — the 27 steps of Ascent's precon process
 * (the "[Project] - Preconstrcution Process Checklist" sheet), grouped into the
 * four phases of the client-facing "Pre-Construction Process Overview" doc.
 * Shown on the Jobs page's Precon tab; progress on the Job Board's PreCon cards.
 *
 * Each step has a status (not started, in progress, blocked, done, n/a) and a
 * note. A job can hide a step, add its own, and keep free-text open questions.
 * One `PreconState` per job in the companion DB (`precon_checklists`). Nothing
 * here is written to JobTread. Per-person to-dos stay in JobTread (owner,
 * 2026-11-23).
 *
 * Steps are keyed by phase and a slug of their text, as the Punch List keys its
 * items, so adding a step does not shift another's key. Rewording one starts it
 * fresh on every job. Pure. Unit-tested.
 */

export type PreconStatus = "todo" | "progress" | "blocked" | "done" | "na";

export const STATUS_LABEL: Record<PreconStatus, string> = {
  todo: "Not started",
  progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  na: "N/A",
};
/** The order the status menu lists them in. */
export const STATUS_CYCLE: PreconStatus[] = ["todo", "progress", "done", "blocked", "na"];

export type PreconPhase = { id: string; title: string; steps: { key: string; text: string }[] };
export type PreconStep = { status: PreconStatus; note: string; by: string; at: string };
export type PreconCustom = { key: string; phase: string; text: string };

export type PreconState = {
  /** Steps someone has touched, by key. A step with no entry is not started. */
  steps: Record<string, PreconStep>;
  /** Template or added steps taken off this job's list. */
  hidden: string[];
  /** Steps the office added to this job, in the order added. */
  custom: PreconCustom[];
  /** Free text: open questions for the job. */
  questions: string;
};

export type PreconOp =
  | { op: "status"; key: string; status: PreconStatus }
  | { op: "note"; key: string; text: string }
  | { op: "hide"; key: string; hidden: boolean }
  | { op: "add"; phase: string; text: string; key: string }
  | { op: "remove"; key: string }
  | { op: "questions"; text: string };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

// The sheet's 27 rows, in its order. Spelling fixed only (owner, 2026-11-23).
const RAW: [string, string, string[]][] = [
  [
    "dd",
    "Design Development",
    [
      "Study and assessment of Design Development set of plans",
      "RFP (Request for Pricing) from preferred subcontractors",
      "Apply allowances for material and labor based on recent historicals and in-process projects",
      "Present ROM estimate to customer and architect",
      "Receive customer's feedback from ROM estimate",
      "Receive architect's feedback from ROM estimate",
      "Align as a team on clear path forward and any remaining work to be done ahead of receiving the Permit set of plans",
    ],
  ],
  [
    "permit",
    "Permit Set",
    [
      "Receive Permit set of plans",
      "Study of material selections, finishes, furnishings and structural components",
      "RFP for material selections, finishes, furnishings and structural components",
      "Request feedback from customer",
      "Request feedback from architect",
      "Value Engineering with customer and architect",
      "Receive customer's feedback from initial estimate and VE exercise",
      "Receive architect's feedback from initial estimate and VE exercise",
      "Revise estimate based on VE decisions",
      "Create contract estimate and present to customer",
      "Ensure alignment between design and cost presented in initial estimate ahead of receiving the CD set of plans",
    ],
  ],
  [
    "cd",
    "Construction Documents",
    [
      "Receive CD set of plans",
      "Revisit each line item and identify any remaining items that need to be adjusted, added, or removed",
      "RFP for any added scope or outstanding items",
      "Adjust, add, remove scope and cost as prescribed",
      "Complete contract estimate and present to customer and architect",
    ],
  ],
  [
    "contract",
    "Contract & Mobilization",
    [
      "Send contract estimate and contract agreement via email for customer review and approval",
      "Once approved, send construction agreement via DocuSign",
      "Send request to customer to pay 10% deposit",
      "Once construction agreement is fully executed and deposit received, ensure place in block schedule and begin coordinating excavation activities",
    ],
  ],
];

export const PRECON_TEMPLATE: PreconPhase[] = RAW.map(([id, title, steps]) => ({
  id,
  title,
  steps: steps.map((text) => ({ key: `${id}.${slug(text)}`, text })),
}));

const PHASE_IDS = new Set(PRECON_TEMPLATE.map((p) => p.id));
const TEMPLATE_KEYS = new Set(PRECON_TEMPLATE.flatMap((p) => p.steps.map((s) => s.key)));
const STATUSES = new Set<PreconStatus>(STATUS_CYCLE);

export const emptyPreconState = (): PreconState => ({ steps: {}, hidden: [], custom: [], questions: "" });

const TEXT_MAX = 5000;
const NOTE_MAX = 1000;

/** A stored value, or anything else, as a PreconState. Unknown shapes read as empty. */
export function asPreconState(v: unknown): PreconState {
  const o = (v && typeof v === "object" ? v : {}) as Partial<PreconState>;
  const steps: Record<string, PreconStep> = {};
  if (o.steps && typeof o.steps === "object")
    for (const [k, d] of Object.entries(o.steps))
      if (d && typeof d === "object")
        steps[k] = {
          status: STATUSES.has(d.status) ? d.status : "todo",
          note: typeof d.note === "string" ? d.note : "",
          by: String(d.by ?? ""),
          at: String(d.at ?? ""),
        };
  return {
    steps,
    hidden: Array.isArray(o.hidden) ? o.hidden.filter((k): k is string => typeof k === "string") : [],
    custom: Array.isArray(o.custom)
      ? o.custom
          .filter((c) => c && typeof c.key === "string" && typeof c.text === "string")
          .map((c) => ({ key: c.key, phase: String(c.phase ?? ""), text: c.text }))
      : [],
    questions: typeof o.questions === "string" ? o.questions : "",
  };
}

/** An op from the browser, checked. Null when it is not one. */
export function asPreconOp(v: unknown): PreconOp | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (o.op === "questions") return { op: "questions", text: String(o.text ?? "").slice(0, TEXT_MAX) };
  const key = typeof o.key === "string" ? o.key.slice(0, 120) : "";
  if (!key) return null;
  if (o.op === "status") return STATUSES.has(o.status as PreconStatus) ? { op: "status", key, status: o.status as PreconStatus } : null;
  if (o.op === "note") return { op: "note", key, text: String(o.text ?? "").slice(0, NOTE_MAX) };
  if (o.op === "hide") return { op: "hide", key, hidden: !!o.hidden };
  if (o.op === "remove") return { op: "remove", key };
  if (o.op === "add") {
    const text = typeof o.text === "string" ? o.text.trim().slice(0, 300) : "";
    const phase = typeof o.phase === "string" ? o.phase : "";
    if (!text || !PHASE_IDS.has(phase) || !key.startsWith("c-")) return null;
    return { op: "add", phase, text, key };
  }
  return null;
}

/** A key an added step can take: "c-" and random letters. */
export const newCustomKey = () => `c-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The state after one op. Ops on a key the job does not have are no-ops, and
 * only an added step can be removed — a template step is hidden instead.
 */
export function applyPreconOp(s: PreconState, op: PreconOp, by: string, at: string): PreconState {
  const known = (k: string) => TEMPLATE_KEYS.has(k) || s.custom.some((c) => c.key === k);
  const step = (k: string): PreconStep => s.steps[k] ?? { status: "todo", note: "", by: "", at: "" };
  switch (op.op) {
    case "status":
      if (!known(op.key)) return s;
      return { ...s, steps: { ...s.steps, [op.key]: { ...step(op.key), status: op.status, by, at } } };
    case "note":
      if (!known(op.key)) return s;
      return { ...s, steps: { ...s.steps, [op.key]: { ...step(op.key), note: op.text, by, at } } };
    case "hide": {
      if (!known(op.key)) return s;
      const hidden = s.hidden.filter((k) => k !== op.key);
      return { ...s, hidden: op.hidden ? [...hidden, op.key] : hidden };
    }
    case "add":
      if (known(op.key)) return s;
      return { ...s, custom: [...s.custom, { key: op.key, phase: op.phase, text: op.text }] };
    case "remove": {
      if (!s.custom.some((c) => c.key === op.key)) return s;
      const steps = { ...s.steps };
      delete steps[op.key];
      return {
        ...s,
        steps,
        hidden: s.hidden.filter((k) => k !== op.key),
        custom: s.custom.filter((c) => c.key !== op.key),
      };
    }
    case "questions":
      return { ...s, questions: op.text };
  }
}

export type PreconRow = { key: string; text: string; custom: boolean; hidden: boolean; step: PreconStep };

/** Each phase's rows for a job: the template's, then the ones added to it. */
export function preconRows(s: PreconState): { id: string; title: string; rows: PreconRow[] }[] {
  const hidden = new Set(s.hidden);
  const row = (key: string, text: string, custom: boolean): PreconRow => ({
    key,
    text,
    custom,
    hidden: hidden.has(key),
    step: s.steps[key] ?? { status: "todo", note: "", by: "", at: "" },
  });
  return PRECON_TEMPLATE.map((p) => ({
    id: p.id,
    title: p.title,
    rows: [
      ...p.steps.map((i) => row(i.key, i.text, false)),
      ...s.custom.filter((c) => c.phase === p.id).map((c) => row(c.key, c.text, true)),
    ],
  }));
}

export type PreconProgress = {
  /** Steps marked done. */
  done: number;
  /** Listed steps that count: not hidden, not N/A. */
  total: number;
  blocked: number;
  /** The first phase with a step left; "Done" when none is. */
  phase: string;
};

/** "Permit Set · 12/27": where the job stands. */
export function preconProgress(s: PreconState): PreconProgress {
  let done = 0;
  let total = 0;
  let blocked = 0;
  let phase = "";
  for (const p of preconRows(s)) {
    for (const r of p.rows) {
      if (r.hidden || r.step.status === "na") continue;
      total++;
      if (r.step.status === "done") done++;
      else if (!phase) phase = p.title;
      if (r.step.status === "blocked") blocked++;
    }
  }
  return { done, total, blocked, phase: phase || "Done" };
}

/** True when no one has touched the checklist yet. */
export const preconStarted = (s: PreconState) =>
  Object.keys(s.steps).length > 0 || s.custom.length > 0 || s.hidden.length > 0 || s.questions.trim() !== "";
