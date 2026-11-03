/**
 * A job's Punch List — Ascent's Residential Final Inspection Checklist (San Juan
 * County), checked off per job on the Jobs page's Punch List tab.
 *
 * The checklist below is the starting list for every job. A job's own state
 * (what is done, which template items are hidden, the items the office added)
 * and its notes and sign-off) is one `PunchState` per job in the companion DB
 * (`punch_lists`). The sign-off takes a date and a drawn signature, and only
 * once every listed item is done (`punchComplete`). Companion
 * data only: nothing here is written to JobTread.
 *
 * Template items are keyed by section and a slug of their text, so adding an
 * item to the template does not shift another item's key. Rewording one starts
 * it fresh on every job. Pure. Unit-tested.
 */

export type PunchSection = { id: string; title: string; items: { key: string; text: string }[] };

export type PunchDone = { by: string; at: string };
export type PunchCustom = { key: string; section: string; text: string };
/** The sign-off: the date written and the drawn signature (a PNG data URL). */
export type PunchSignoff = { date: string; signature: string; by: string; at: string };

export type PunchState = {
  /** Done items, by key: who ticked it and when. */
  done: Record<string, PunchDone>;
  /** Template or added items taken off this job's list. */
  hidden: string[];
  /** Items the office added to this job, in the order added. */
  custom: PunchCustom[];
  /** Free text under the list: outstanding items, corrections. */
  notes: string;
  signoff: PunchSignoff | null;
};

export type PunchOp =
  | { op: "check"; key: string; done: boolean }
  | { op: "hide"; key: string; hidden: boolean }
  | { op: "add"; section: string; text: string; key: string }
  | { op: "remove"; key: string }
  | { op: "notes"; text: string }
  | { op: "sign"; date: string; signature: string }
  | { op: "unsign" };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const RAW: [string, string, string[]][] = [
  [
    "permit",
    "Permit & Documentation",
    [
      "Approved building plans available on site",
      "All approved plan revisions incorporated",
      "All permit conditions reviewed and satisfied",
      "Required building inspections completed and approved",
      "Required electrical inspection approved by Washington L&I",
      "Required plumbing inspections completed",
      "Required mechanical inspections completed",
      "Fire Marshal inspections and approvals completed, if applicable",
      "Critical areas, shoreline, flood, or other agency approvals completed, if applicable",
      "Required special inspection reports submitted, if applicable",
      "Required engineering letters and certifications submitted",
      "Address clearly posted and visible from access road",
    ],
  ],
  [
    "site",
    "Site & Exterior",
    [
      "Emergency vehicle access and required driveway access maintained",
      "Site grading completed in accordance with approved plans",
      "Positive drainage away from foundation",
      "Surface water directed to approved drainage locations",
      "Erosion and sediment controls maintained until no longer required",
      "No exposed or unstable excavations",
      "Retaining walls completed and approved, if applicable",
      "Required guardrails and handrails installed",
      "Exterior siding and trim complete",
      "Roofing complete, including flashing and penetrations",
      "Gutters and downspouts installed and discharged appropriately",
      "Exterior doors and windows installed and operational",
      "All exterior penetrations sealed",
      "Decks, stairs, landings, and balconies complete",
      "Deck and stair guards installed where required",
      "Exterior stair handrails installed where required",
      "Required tempered safety glazing installed",
      "Exterior lighting operational",
      "Exterior outlets and covers installed",
      "Hose bibs and exterior plumbing complete",
      "Chimney and fireplace terminations complete, if applicable",
    ],
  ],
  [
    "safety",
    "Life Safety & Egress",
    [
      "Smoke alarms installed in required locations",
      "Smoke alarms interconnected where required",
      "Carbon monoxide alarms installed in required locations",
      "Required fire separation and fireblocking complete",
      "Garage-to-house separation complete, if applicable",
      "Garage-house door meets applicable requirements",
      "Bedroom egress windows or doors meet requirements",
      "Emergency escape and rescue openings are operational",
      "Required emergency escape window wells and ladders installed",
      "Stair geometry complies with approved plans and applicable code",
      "Stair handrails secure and properly installed",
      "Guards secure and compliant with applicable requirements",
      "Safety glazing installed at required locations",
      "Fireplace and woodstove clearances verified",
      "Required fire extinguishers or fire protection equipment installed, if applicable",
    ],
  ],
  [
    "interior",
    "Interior Completion",
    [
      "All drywall, ceilings, and required finishes complete",
      "Required fire-rated assemblies complete",
      "All doors installed and operating properly",
      "Door hardware and latching operational",
      "Windows open, close, and lock properly",
      "Window safety devices installed where required",
      "All stairs and landings complete",
      "Required guards and handrails installed",
      "All floor openings and hazardous conditions addressed",
      "Required access panels installed",
      "Attic access provided",
      "Crawlspace access provided",
      "Required crawlspace and attic ventilation complete",
      "Mechanical and electrical equipment accessible for service",
      "No exposed wiring, piping, or unfinished construction conditions",
      "Interior surfaces and finishes substantially complete",
    ],
  ],
  [
    "plumbing",
    "Plumbing",
    [
      "All plumbing fixtures installed and operational",
      "Toilets properly secured and functioning",
      "Sinks and faucets operational",
      "Showers and tubs operational",
      "Hot and cold water supplied correctly",
      "No visible plumbing leaks",
      "Drains functioning properly",
      "Traps and cleanouts accessible",
      "Water heater installed and operational",
      "Temperature and pressure relief valve installed and discharged correctly",
      "Required water heater seismic restraint installed",
      "Required backflow prevention installed",
      "Hose bibs operational",
      "Required plumbing insulation complete",
      "Required plumbing permits and inspections approved",
    ],
  ],
  [
    "mechanical",
    "Mechanical, Ventilation & Heating",
    [
      "Heating system installed and operational",
      "Thermostats installed and operational",
      "Required ventilation system installed and operational",
      "Whole-house ventilation controls accessible and labeled",
      "Exhaust fans installed and operational",
      "Bathroom fans exhaust to approved exterior locations",
      "Kitchen exhaust installed and operational",
      "Dryer exhaust installed and terminated appropriately",
      "HVAC ducts sealed and insulated where required",
      "Mechanical equipment condensate drains complete",
      "Combustion air provided where required",
      "Gas piping and connections inspected, if applicable",
      "Gas appliances operational, if applicable",
      "Required equipment clearances maintained",
      "Mechanical equipment access maintained",
      "Required mechanical permits and inspections approved",
    ],
  ],
  [
    "electrical",
    "Electrical",
    [
      "Washington L&I final electrical inspection approved",
      "Electrical service and panel complete",
      "Panel directory completed and accurate",
      "All required breakers installed",
      "GFCI protection installed where required",
      "AFCI protection installed where required",
      "Required tamper-resistant receptacles installed",
      "Receptacles, switches, and cover plates installed",
      "Required lighting fixtures installed",
      "Exterior receptacles and weatherproof covers installed",
      "Required bathroom and kitchen receptacles operational",
      "Smoke and CO alarms operational",
      "Required disconnects installed and labeled",
      "Equipment grounding and bonding complete",
      "All electrical equipment properly secured",
      "Electrical panel access and working clearances maintained",
      "EV charging equipment inspected, if applicable",
      "Solar and battery systems inspected, if applicable",
    ],
  ],
  [
    "energy",
    "Energy Code & Building Envelope",
    [
      "Required insulation installed and documented",
      "Windows and exterior doors meet approved energy specifications",
      "Window U-values verified against approved energy documents",
      "Building envelope air sealing complete",
      "Required blower door test completed and passed",
      "Required duct leakage testing completed, if applicable",
      "Required energy credits documented",
      "Required lighting efficiency verified",
      "Required ventilation compliance documented",
      "Energy compliance forms and test reports submitted",
      "Required mechanical ventilation commissioning completed",
    ],
  ],
  [
    "utilities",
    "Septic, Water & Site Utilities",
    [
      "Septic system installation approved, if applicable",
      "Septic startup or existing system functionality verified with Health Department",
      "Required septic documentation submitted",
      "Water system operational",
      "Water pressure and flow verified",
      "Well equipment operational, if applicable",
      "Water treatment equipment operational, if applicable",
      "Required water testing completed, if applicable",
      "Underground utilities and service connections complete",
      "Drainage and stormwater facilities complete",
      "Required utility clearances maintained",
    ],
  ],
  [
    "cleanup",
    "Final Site Cleanup & Presentation",
    [
      "Construction debris removed",
      "Excess materials and equipment removed",
      "Temporary construction facilities removed",
      "Erosion control maintained as required",
      "Driveway and access areas clear",
      "Landscaping and required site restoration complete",
      "All exterior doors and gates accessible",
      "Building and equipment identification labels installed",
      "All areas accessible for inspection",
      "All utilities turned on for testing",
      "Keys, access codes, and equipment controls available",
    ],
  ],
  [
    "final",
    "Final Inspection & Occupancy",
    [
      "Final walkthrough completed by Project Manager",
      "All applicable checklist items completed",
      "All previous inspection corrections resolved",
      "All required third-party approvals received",
      "All required reports uploaded to permit portal",
      "Final inspection requested with San Juan County DCD",
      "Final inspection passed",
      "Certificate of Occupancy issued, if required",
      "Final approval documented in permit portal",
      "Project closeout documentation assembled",
    ],
  ],
];

export const PUNCH_TEMPLATE: PunchSection[] = RAW.map(([id, title, items]) => ({
  id,
  title,
  items: items.map((text) => ({ key: `${id}.${slug(text)}`, text })),
}));

const SECTION_IDS = new Set(PUNCH_TEMPLATE.map((s) => s.id));
const TEMPLATE_KEYS = new Set(PUNCH_TEMPLATE.flatMap((s) => s.items.map((i) => i.key)));

export const emptyPunchState = (): PunchState => ({
  done: {},
  hidden: [],
  custom: [],
  notes: "",
  signoff: null,
});

const NOTES_MAX = 5000;
/** A drawn signature is ~10–40 KB; this caps a runaway one. */
const SIGNATURE_MAX = 300_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isSignature = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length <= SIGNATURE_MAX;

/** A stored value, or anything else, as a PunchState. Unknown shapes read as empty. */
export function asPunchState(v: unknown): PunchState {
  const o = (v && typeof v === "object" ? v : {}) as Partial<PunchState>;
  const done: Record<string, PunchDone> = {};
  if (o.done && typeof o.done === "object")
    for (const [k, d] of Object.entries(o.done))
      if (d && typeof d === "object") done[k] = { by: String(d.by ?? ""), at: String(d.at ?? "") };
  return {
    done,
    hidden: Array.isArray(o.hidden) ? o.hidden.filter((k): k is string => typeof k === "string") : [],
    custom: Array.isArray(o.custom)
      ? o.custom
          .filter((c) => c && typeof c.key === "string" && typeof c.text === "string")
          .map((c) => ({ key: c.key, section: String(c.section ?? ""), text: c.text }))
      : [],
    notes: typeof o.notes === "string" ? o.notes : "",
    signoff:
      o.signoff && typeof o.signoff === "object" && isSignature(o.signoff.signature)
        ? {
            date: String(o.signoff.date ?? ""),
            signature: o.signoff.signature,
            by: String(o.signoff.by ?? ""),
            at: String(o.signoff.at ?? ""),
          }
        : null,
  };
}

/** An op from the browser, checked. Null when it is not one. */
export function asPunchOp(v: unknown): PunchOp | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (o.op === "notes") return { op: "notes", text: String(o.text ?? "").slice(0, NOTES_MAX) };
  if (o.op === "unsign") return { op: "unsign" };
  if (o.op === "sign")
    return typeof o.date === "string" && DATE.test(o.date) && isSignature(o.signature)
      ? { op: "sign", date: o.date, signature: o.signature }
      : null;
  const key = typeof o.key === "string" ? o.key.slice(0, 120) : "";
  if (!key) return null;
  if (o.op === "check") return { op: "check", key, done: !!o.done };
  if (o.op === "hide") return { op: "hide", key, hidden: !!o.hidden };
  if (o.op === "remove") return { op: "remove", key };
  if (o.op === "add") {
    const text = typeof o.text === "string" ? o.text.trim().slice(0, 300) : "";
    const section = typeof o.section === "string" ? o.section : "";
    if (!text || !SECTION_IDS.has(section) || !key.startsWith("c-")) return null;
    return { op: "add", section, text, key };
  }
  return null;
}

/** A key an added item can take: "c-" and random letters. */
export const newCustomKey = () => `c-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The state after one op. Ops on a key the job does not have are no-ops, and
 * only an added item can be removed — a template item is hidden instead. A
 * sign-off before every listed item is done is a no-op.
 */
export function applyPunchOp(s: PunchState, op: PunchOp, by: string, at: string): PunchState {
  const known = (k: string) => TEMPLATE_KEYS.has(k) || s.custom.some((c) => c.key === k);
  switch (op.op) {
    case "check": {
      if (!known(op.key)) return s;
      const done = { ...s.done };
      if (op.done) done[op.key] = { by, at };
      else delete done[op.key];
      return { ...s, done };
    }
    case "hide": {
      if (!known(op.key)) return s;
      const hidden = s.hidden.filter((k) => k !== op.key);
      return { ...s, hidden: op.hidden ? [...hidden, op.key] : hidden };
    }
    case "add":
      if (known(op.key)) return s;
      return { ...s, custom: [...s.custom, { key: op.key, section: op.section, text: op.text }] };
    case "remove": {
      if (!s.custom.some((c) => c.key === op.key)) return s;
      const done = { ...s.done };
      delete done[op.key];
      return {
        ...s,
        done,
        hidden: s.hidden.filter((k) => k !== op.key),
        custom: s.custom.filter((c) => c.key !== op.key),
      };
    }
    case "notes":
      return { ...s, notes: op.text };
    case "sign":
      if (!punchComplete(s)) return s;
      return { ...s, signoff: { date: op.date, signature: op.signature, by, at } };
    case "unsign":
      return { ...s, signoff: null };
  }
}

/** Every listed (not hidden) item is done — what the sign-off waits for. */
export function punchComplete(s: PunchState): boolean {
  const rows = punchRows(s).flatMap((x) => x.rows.filter((r) => !r.hidden));
  return rows.length > 0 && rows.every((r) => r.done);
}

export type PunchRow = { key: string; text: string; custom: boolean; hidden: boolean; done: PunchDone | null };

/** Each section's rows for a job: the template's, then the ones added to it. */
export function punchRows(s: PunchState): { id: string; title: string; rows: PunchRow[] }[] {
  const hidden = new Set(s.hidden);
  const row = (key: string, text: string, custom: boolean): PunchRow => ({
    key,
    text,
    custom,
    hidden: hidden.has(key),
    done: s.done[key] ?? null,
  });
  return PUNCH_TEMPLATE.map((sec) => ({
    id: sec.id,
    title: sec.title,
    rows: [
      ...sec.items.map((i) => row(i.key, i.text, false)),
      ...s.custom.filter((c) => c.section === sec.id).map((c) => row(c.key, c.text, true)),
    ],
  }));
}
