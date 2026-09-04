/**
 * Reader for the Daily Digest's morning brief.
 *
 * The brief is ONE STRING, but it is written in TOPIC BLOCKS: paragraphs
 * separated by a blank line, and lines beginning "- " meaning a bullet. The
 * writer is `fallbackSummary` in src/lib/digest/run.ts (a Claude-written brief
 * was the other writer until 2026-09-04).
 *
 * Parsing stays forgiving, which is also what lets stored rows from the model
 * era still render: any of "-", "*" or "•" opens a bullet, consecutive bullets
 * collect into one list, consecutive prose lines collect into one paragraph,
 * and stray "**" bold markers are stripped rather than shown as literal
 * asterisks. Kept OUT of the component (src/components/DailyDigest.tsx draws
 * what this returns) so the unit suite — which runs no React — can test it. A brief with no blank lines and no bullets at all — an older
 * stored digest, or a model that ignored the format — comes back as a single
 * paragraph, which is exactly what this card used to draw.
 */
export type SummaryBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

const BULLET = /^\s*[-*•]\s+/;

export function parseSummary(text: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = [];
  // Strip markdown emphasis the prompt asks for but a model may still emit.
  const clean = (t: string) => t.replace(/\*\*/g, "").trim();

  for (const raw of text.split(/\n\s*\n/)) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    let prose: string[] = [];
    let bullets: string[] = [];
    // A blank line is not the only break: within one block, prose followed by
    // bullets (a lead line above its list) has to split into two blocks too.
    const flush = () => {
      if (prose.length) blocks.push({ kind: "p", text: clean(prose.join(" ")) });
      if (bullets.length) blocks.push({ kind: "ul", items: bullets.map(clean).filter(Boolean) });
      prose = [];
      bullets = [];
    };
    for (const line of lines) {
      if (BULLET.test(line)) {
        if (prose.length) flush();
        bullets.push(line.replace(BULLET, ""));
      } else {
        if (bullets.length) flush();
        prose.push(line);
      }
    }
    flush();
  }
  return blocks.filter((b) => (b.kind === "p" ? b.text.length > 0 : b.items.length > 0));
}
