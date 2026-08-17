/**
 * "Reading Your Own App" — the in-app course metadata.
 *
 * PURE data + pure functions only (no React, DB, or browser APIs) so it is safe
 * to import from server components, client components, and the launcher alike.
 * The prose for each segment lives in src/app/course/segments.tsx; this module
 * is only the syllabus (numbers, titles, units, ready flags) that the home page,
 * the segment reader, and the progress hook all agree on.
 *
 * The written source of record is docs/course/*.md. When a segment is added
 * there, add its metadata row here and its body in segments.tsx, and flip
 * `ready` to true.
 */

export interface SegmentMeta {
  /** 1-based segment number; also its route (/course/<n>). */
  n: number;
  title: string;
  /** The one-line question the segment answers — shown as the row's subtitle. */
  question: string;
  unit: string;
  /** Rough reading time in minutes. */
  minutes: number;
  /** True once the body exists in segments.tsx. Unwritten rows show "Soon". */
  ready: boolean;
}

export const UNITS = [
  "Unit A — Orientation",
  "Unit B — The JobTread layer",
  "Unit C — The workflows",
  "Unit D — Around the edges",
] as const;

export const SEGMENTS: SegmentMeta[] = [
  { n: 1, unit: UNITS[0], minutes: 40, ready: true,
    title: "The shape of the thing",
    question: "What the app is, its three back ends, and one complete round trip from tap to screen" },
  { n: 2, unit: UNITS[0], minutes: 35, ready: false,
    title: "The door",
    question: "Sign-in, the four roles, per-user overrides, and why gating happens on the server" },
  { n: 3, unit: UNITS[1], minutes: 40, ready: false,
    title: "Talking to JobTread",
    question: "The Pave query grammar, the client that speaks it, retries, caching, and the expensive gotchas" },
  { n: 4, unit: UNITS[1], minutes: 40, ready: false,
    title: "The gateway and write safety",
    question: "The one generic door into JobTread, the two write flags, and the per-role allowlist" },
  { n: 5, unit: UNITS[1], minutes: 40, ready: false,
    title: "The money model",
    question: "Jobs, budgets, cost items, documents, and why unbilled is a subtraction" },
  { n: 6, unit: UNITS[2], minutes: 45, ready: false,
    title: "The billing workflow",
    question: "A bill's whole life: arrives, coded, approved, invoiced — screen by screen" },
  { n: 7, unit: UNITS[2], minutes: 40, ready: false,
    title: "The other back end",
    question: "The Apps Script bridge to Sheets and Drive, the shared secret, and the hourly mirror" },
  { n: 8, unit: UNITS[2], minutes: 35, ready: false,
    title: "The companion database",
    question: "What earns a place in the app's own database, with PTO accrual as the worked example" },
  { n: 9, unit: UNITS[2], minutes: 40, ready: false,
    title: "The field apps",
    question: "Time, mileage, safety sign-ins, tools — phone hardware in, JobTread and Sheets out" },
  { n: 10, unit: UNITS[3], minutes: 35, ready: false,
    title: "The AI parts",
    question: "Gemini reading invoices, Claude answering questions, and why the assistant is read-only" },
  { n: 11, unit: UNITS[3], minutes: 30, ready: false,
    title: "The look and the words",
    question: "The design system, and the on-screen text you can reword without a deploy" },
  { n: 12, unit: UNITS[3], minutes: 40, ready: false,
    title: "How it ships, how it breaks",
    question: "Branches, previews, production, environment variables, tests, and the known weak points" },
];

export const TOTAL = SEGMENTS.length;

/** The six-segment core, called out on the home page as the fast path. */
export const FAST_PATH = [1, 2, 4, 5, 6, 7];

export function getSegment(n: number): SegmentMeta | undefined {
  return SEGMENTS.find((s) => s.n === n);
}

/** Segments in a unit, in order — for grouping the syllabus. */
export function segmentsInUnit(unit: string): SegmentMeta[] {
  return SEGMENTS.filter((s) => s.unit === unit);
}

/**
 * The next segment worth pointing someone at: the first ready, not-yet-done one.
 * Returns null when everything written so far is complete.
 */
export function nextReady(done: number[]): number | null {
  const first = SEGMENTS.find((s) => s.ready && !done.includes(s.n));
  return first ? first.n : null;
}

/** The ready segment before/after `n`, or null — for the reader's prev/next. */
export function adjacentReady(n: number, dir: -1 | 1): SegmentMeta | null {
  for (let i = n + dir; i >= 1 && i <= TOTAL; i += dir) {
    const s = getSegment(i);
    if (s?.ready) return s;
  }
  return null;
}
