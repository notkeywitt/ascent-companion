/**
 * The Admin Change Log. Pure rules, no I/O, so a test can pin them.
 *
 * Plain .mjs because the lander runs scripts/changelog/generate.mjs with bare
 * Node; the app and the test import it too (allowJs).
 *
 * An entry is { sha, date, title, plain }, newest first, in src/data/changelog.json.
 * `plain` is the commit body's `Change-log: <sentence>` line, else the title.
 */

/** `git log --format=` for parseLog: fields split by US, commits by RS. */
export const LOG_FORMAT = "%H%x1f%aI%x1f%s%x1f%b%x1e";

/** How many hex digits of a sha the log keeps. */
export const SHA_LEN = 8;

/** A lander merge or the lander's own change-log commit: not a change to record. */
export function isLanderCommit(subject) {
  return /^companion: land /.test(subject) || /^lander:/.test(subject) || /^Merge /.test(subject);
}

/** The body's `Change-log:` sentence, or the title when there is none. */
export function plainFrom(body, title) {
  const m = String(body).match(/^Change-log:[ \t]*(.+)$/im);
  return m ? m[1].trim() : title;
}

/** Output of `git log --format=LOG_FORMAT` → entries, newest first, lander commits dropped. */
export function parseLog(text) {
  const entries = [];
  for (const rec of String(text).split("\x1e")) {
    const [sha, date, subject, body = ""] = rec.replace(/^\s+/, "").split("\x1f");
    if (!sha || !subject || isLanderCommit(subject)) continue;
    const title = subject.replace(/^companion:\s*/, "").trim() || subject;
    entries.push({ sha: sha.slice(0, SHA_LEN), date, title, plain: plainFrom(body, title) });
  }
  return entries;
}

/** New entries on top of the log; a sha already there is not added twice. */
export function mergeEntries(existing, fresh) {
  const seen = new Set(existing.map((e) => e.sha));
  return [...fresh.filter((e) => !seen.has(e.sha)), ...existing];
}
