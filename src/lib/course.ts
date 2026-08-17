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

// Titles and one-line teasers are written in ASD-STE100 (Simplified Technical
// English) style: short sentences, plain words, no idioms, no contractions.
// See docs/course/README.md and docs/course/01-the-shape-of-the-thing.md for
// the same standard applied to the full segment prose.
export const SEGMENTS: SegmentMeta[] = [
  { n: 1, unit: UNITS[0], minutes: 40, ready: true,
    title: "How the App Is Built",
    question: "The app's 3 back ends. 1 full request, from a tap on the phone to the answer on the screen." },
  { n: 2, unit: UNITS[0], minutes: 35, ready: false,
    title: "Sign-In and Roles",
    question: "Sign-in rules. The 4 roles. Why the server, not the screen, blocks a page." },
  { n: 3, unit: UNITS[1], minutes: 40, ready: false,
    title: "The JobTread Query Language",
    question: "The Pave query grammar. Retries. Caches. Costly mistakes to avoid." },
  { n: 4, unit: UNITS[1], minutes: 40, ready: false,
    title: "The Gateway and Write Rules",
    question: "The 1 general door into JobTread. The 2 write switches. The rule list for each role." },
  { n: 5, unit: UNITS[1], minutes: 40, ready: false,
    title: "How the App Tracks Money",
    question: "Jobs, budgets, cost items, documents. Why the app calculates the unbilled amount." },
  { n: 6, unit: UNITS[2], minutes: 45, ready: false,
    title: "The Billing Process",
    question: "A bill's full life: it arrives, gets a code, gets approval, becomes part of an invoice." },
  { n: 7, unit: UNITS[2], minutes: 40, ready: false,
    title: "The Sheets and Drive System",
    question: "The Apps Script bridge. The shared secret. The hourly sync job." },
  { n: 8, unit: UNITS[2], minutes: 35, ready: false,
    title: "The Companion Database",
    question: "What earns a place in the app's own database. PTO accrual as the example." },
  { n: 9, unit: UNITS[2], minutes: 40, ready: false,
    title: "The Field Screens",
    question: "Time entries, mileage, safety sign-in, tools. Phone data in; JobTread and Sheets out." },
  { n: 10, unit: UNITS[3], minutes: 35, ready: false,
    title: "The AI Features",
    question: "Gemini reads invoices. Claude answers questions. Why the assistant never writes data." },
  { n: 11, unit: UNITS[3], minutes: 30, ready: false,
    title: "The Design System and Editable Text",
    question: "Why every screen matches. On-screen text a user can edit, with no new deployment." },
  { n: 12, unit: UNITS[3], minutes: 40, ready: false,
    title: "Deployment and Known Problems",
    question: "Branches. Preview builds. Production. Environment variables. Tests. Known weak points." },
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
