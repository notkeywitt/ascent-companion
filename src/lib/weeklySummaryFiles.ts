/**
 * Weekly Summary — the saved files, read when the page builds.
 *
 * Server only. One record per week: the `-final.md` (the email as the office
 * manager left it) when it exists, else the `-claude.md` draft. Newest week
 * first. A file that will not read is skipped, so one bad file never hides the
 * rest.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parseSummary, parseSummaryFile, type ParsedSummary } from "@/lib/weeklySummary";

export const SUMMARY_DIR = path.join(process.cwd(), ".claude", "skills", "weekly-summary", "drafts");

export interface SummaryRecord extends ParsedSummary {
  /** The Saturday that closes the week, YYYY-MM-DD. */
  weekEnd: string;
  /** `final` once the office's edited version is saved, else the first draft. */
  kind: "claude" | "final";
}

export function readSummaries(dir: string = SUMMARY_DIR): SummaryRecord[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const byWeek = new Map<string, { claude?: string; final?: string }>();
  for (const name of names) {
    const f = parseSummaryFile(name);
    if (!f) continue;
    byWeek.set(f.weekEnd, { ...byWeek.get(f.weekEnd), [f.kind]: name });
  }

  const out: SummaryRecord[] = [];
  for (const [weekEnd, files] of byWeek) {
    const kind = files.final ? "final" : "claude";
    const name = files.final ?? files.claude;
    if (!name) continue;
    try {
      const parsed = parseSummary(readFileSync(path.join(dir, name), "utf8"));
      // A final that lost its link keeps the draft's: the Doc is the same one.
      if (kind === "final" && !parsed.docUrl && files.claude) {
        parsed.docUrl = parseSummary(readFileSync(path.join(dir, files.claude), "utf8")).docUrl;
      }
      out.push({ ...parsed, weekEnd, kind });
    } catch {
      /* skip an unreadable file */
    }
  }
  return out.sort((a, b) => b.weekEnd.localeCompare(a.weekEnd));
}
