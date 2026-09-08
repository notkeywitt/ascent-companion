import { describe, expect, it } from "vitest";
import { ALL_TOPICS, HELP, getHelpTopic, searchHelp, visibleHelp } from "./help";
import { ALL_VIEW_IDS, ROLE_VIEWS } from "./views";

/**
 * The help topics.
 *
 * Two kinds of check, and the second is the unusual one:
 *
 *  1. WIRING — an id is unique (it is a URL hash), a `view` is a real gate id,
 *     a gated topic points at a page, and the search ranks the question above
 *     the body.
 *  2. THE WRITING STANDARD — ASD-STE100 sets a hard sentence length and one
 *     instruction per step. Those two rules are the ones that decay first when
 *     a topic is edited in a hurry, and they are countable, so they are tested
 *     rather than trusted. See the header of help.ts for the full rule set.
 */

/** Words, ignoring the `**bold**` markers, which are markup and not words. */
const words = (s: string) => s.replace(/\*\*/g, "").trim().split(/\s+/).length;

describe("wiring", () => {
  it("gives every topic a unique id", () => {
    const ids = ALL_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names a real view, or none at all", () => {
    for (const t of ALL_TOPICS) {
      if (t.view === null) continue;
      expect(ALL_VIEW_IDS, `${t.id} names view "${t.view}"`).toContain(t.view);
    }
  });

  it("gives every topic a question and something to read", () => {
    for (const t of ALL_TOPICS) {
      expect(t.q.endsWith("?"), `${t.id} is not a question`).toBe(true);
      const body = (t.steps?.length ?? 0) + (t.notes?.length ?? 0) + (t.warn?.length ?? 0);
      expect(body, `${t.id} has no steps and no notes`).toBeGreaterThan(0);
    }
  });

  it("finds a topic by id", () => {
    expect(getHelpTopic("clock-in")?.view).toBe("employee-time");
    expect(getHelpTopic("not-a-topic")).toBeUndefined();
  });
});

describe("who sees what", () => {
  const canFor = (role: keyof typeof ROLE_VIEWS) => {
    const set = new Set(ROLE_VIEWS[role]);
    return (id: string) => set.has(id);
  };

  it("shows a field user the pages they actually have", () => {
    const sections = visibleHelp(canFor("field"));
    const ids = sections.flatMap((s) => s.topics).map((t) => t.id);
    expect(ids).toContain("clock-in");
    expect(ids).toContain("sign-in");
    // Billing pages are not a field view, so their topics must not show.
    expect(ids).not.toContain("code-bill");
    expect(ids).not.toContain("invoice-review");
  });

  it("shows an admin every topic", () => {
    const shown = visibleHelp(canFor("admin")).flatMap((s) => s.topics);
    expect(shown).toHaveLength(ALL_TOPICS.length);
  });

  it("drops a section that empties out", () => {
    // Nobody can see anything: every section goes, rather than a heading over
    // nothing.
    expect(visibleHelp(() => false).every((s) => s.topics.length > 0)).toBe(true);
  });

  it("keeps the everyone topics for a user with no views at all", () => {
    const ids = visibleHelp(() => false)
      .flatMap((s) => s.topics)
      .map((t) => t.id);
    expect(ids).toContain("sign-in");
    expect(ids).not.toContain("clock-in");
  });
});

describe("searchHelp", () => {
  const canAll = () => true;

  it("ignores a query shorter than two characters", () => {
    expect(searchHelp("c", canAll)).toEqual([]);
    expect(searchHelp("  ", canAll)).toEqual([]);
  });

  it("matches the words on a button inside a step", () => {
    // "Tap **Clock out**." — the markers must not break the match.
    expect(searchHelp("clock out", canAll).map((t) => t.id)).toContain("clock-out");
  });

  it("matches a keyword the question never uses", () => {
    expect(searchHelp("pto", canAll).map((t) => t.id)).toContain("time-off");
  });

  it("ranks a hit on the question above a hit in the body", () => {
    const hits = searchHelp("miles", canAll);
    expect(hits[0].q.toLowerCase()).toContain("miles");
  });

  it("hides a topic the reader's role cannot use", () => {
    const can = (id: string) => id !== "payments";
    expect(searchHelp("sunset", can).map((t) => t.id)).not.toContain("payments");
  });

  it("honours the limit", () => {
    expect(searchHelp("the", canAll, 2).length).toBeLessThanOrEqual(2);
  });
});

describe("ASD-STE100", () => {
  it("keeps every step to 20 words", () => {
    for (const t of ALL_TOPICS) {
      for (const s of t.steps ?? []) {
        expect(words(s), `${t.id}: "${s}"`).toBeLessThanOrEqual(20);
      }
    }
  });

  it("keeps every note, warning and blurb to 25 words", () => {
    for (const s of HELP) {
      expect(words(s.blurb), `section ${s.id} blurb`).toBeLessThanOrEqual(25);
    }
    for (const t of ALL_TOPICS) {
      for (const n of [...(t.notes ?? []), ...(t.warn ?? [])]) {
        expect(words(n), `${t.id}: "${n}"`).toBeLessThanOrEqual(25);
      }
    }
  });

  it("keeps a step to one sentence — one instruction per step", () => {
    for (const t of ALL_TOPICS) {
      for (const s of t.steps ?? []) {
        // A step is one sentence, so it ends with one full stop and holds no
        // other sentence-ending mark. "1–15" and "e.g." would trip a naive
        // count, so the test looks for a stop FOLLOWED by another word.
        expect(/[.?!]\s+\S/.test(s), `${t.id} has two sentences in one step: "${s}"`).toBe(false);
        expect(s.endsWith(".") || s.endsWith("?"), `${t.id}: "${s}" has no full stop`).toBe(true);
      }
    }
  });

  it("does not use the words the standard bans", () => {
    // The ones that actually show up in drafts here. "Simply" and "just" tell
    // the reader their trouble is trivial; the rest are padding.
    const banned = /\b(simply|just|basically|essentially|please|utilize|in order to)\b/i;
    for (const t of ALL_TOPICS) {
      for (const s of [t.q, ...(t.steps ?? []), ...(t.notes ?? []), ...(t.warn ?? [])]) {
        expect(banned.test(s), `${t.id}: "${s}"`).toBe(false);
      }
    }
  });
});
