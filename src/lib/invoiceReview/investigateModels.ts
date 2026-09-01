/**
 * WHICH MODELS THE INVESTIGATION MAY RUN ON — the one list, shared by the
 * picker on the page and the route that validates what it sends.
 *
 * ## Why an allowlist rather than a free-text field
 *
 * The model id arrives from the browser. An arbitrary string would let anyone
 * with access to the review point the most expensive call in the app at
 * whatever they liked — a typo bills nothing but fails, and a deliberate choice
 * of a pricier model bills plenty. So the server accepts only what is listed
 * here, and falls back to the default rather than erroring on anything else.
 *
 * ## Why these two and not more
 *
 * Both preserve previous-turn thinking blocks, which is what keeps the loop's
 * conversation cache valid across iterations (Opus 4.5+ and Sonnet 4.6+ behave
 * this way; Haiku 4.5 and earlier STRIP them, so every turn after the first
 * would fall out of cache and the run would cost more on a "cheaper" model).
 * That is a real trap, and the reason the obvious third option is missing.
 *
 * Pure — no server imports — so the page can render the picker from the same
 * source of truth the route validates against.
 */

export interface InvestigateModel {
  id: string;
  /** What the office sees in the picker. */
  label: string;
  /** One line: when to reach for it. */
  blurb: string;
  /** USD per million tokens, for the cost note. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** Rough cost of one run on a busy month, in dollars. An ESTIMATE from the
   *  loop's shape, not a measurement — see the note in the UI. */
  busyMonthEstimate: string;
}

export const INVESTIGATE_MODELS: InvestigateModel[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet",
    blurb: "Enough for most months. Around a fifth the cost of Opus.",
    inputPerMTok: 2,
    outputPerMTok: 10,
    busyMonthEstimate: "20–50¢",
  },
  {
    id: "claude-opus-5",
    label: "Opus",
    blurb: "Better judgement on the awkward ones. Worth it on a messy month.",
    inputPerMTok: 5,
    outputPerMTok: 25,
    busyMonthEstimate: "$0.60–1.50",
  },
];

/**
 * The default.
 *
 * Sonnet, deliberately: most months are a handful of findings with obvious
 * answers, and the office can escalate to Opus on a month that looks messy.
 * `ANTHROPIC_MODEL_INVESTIGATE` still overrides it for a deploy-wide change,
 * but only to something on the list above.
 */
export const DEFAULT_INVESTIGATE_MODEL = "claude-sonnet-5";

export function isInvestigateModel(id: string): boolean {
  return INVESTIGATE_MODELS.some((m) => m.id === id);
}

/** The model to actually run: the caller's choice if it is on the list, else
 *  the env default if THAT is on the list, else Sonnet. Never throws — an
 *  unrecognised id quietly becomes the safe default rather than failing a run
 *  the office already waited on. */
export function resolveInvestigateModel(requested?: string): string {
  const asked = String(requested ?? "").trim();
  if (isInvestigateModel(asked)) return asked;
  const fromEnv = String(process.env.ANTHROPIC_MODEL_INVESTIGATE ?? "").trim();
  if (isInvestigateModel(fromEnv)) return fromEnv;
  return DEFAULT_INVESTIGATE_MODEL;
}

export function investigateModel(id: string): InvestigateModel | undefined {
  return INVESTIGATE_MODELS.find((m) => m.id === id);
}
