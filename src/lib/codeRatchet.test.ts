import { describe, expect, it } from "vitest";

import { compare, measure, measureText, METRICS, readBaseline } from "../../scripts/code-ratchet.mjs";

/**
 * The code ratchet (scripts/code-ratchet.mjs): each count in
 * src/lib/codeRatchet.baseline.json may only go down. A rise fails here and
 * names the file. A fall fails too, until `npm run ratchet` locks it in.
 */

type Move = { metric: string; file: string; was: number; now: number };
const describeMoves = (moves: Move[]) =>
  moves.map((m) => `  ${m.file}: ${m.was} → ${m.now} ${METRICS[m.metric as keyof typeof METRICS]}`).join("\n");

describe("code ratchet", () => {
  const { rises, falls } = compare(readBaseline(), measure());

  it("adds none of the habits being retired", () => {
    expect(
      rises,
      `A count went UP. Fix each one below.\n${describeMoves(rises)}\n` +
        "A moved or renamed file only: run `npm run ratchet` and stage src/lib/codeRatchet.baseline.json.",
    ).toEqual([]);
  });

  it("locks in every improvement", () => {
    expect(
      falls,
      `A count went DOWN — good. Lock it in: run \`npm run ratchet\` and stage src/lib/codeRatchet.baseline.json.\n${describeMoves(falls)}`,
    ).toEqual([]);
  });
});

describe("what the ratchet counts", () => {
  const count = (file: string, text: string) => measureText(file, text);

  it("counts `any` in code, not in comments or strings", () => {
    const c = count("src/lib/x.ts", `// any of these\nconst a: any = 1; const b = "as any"; const d = a as any;`);
    expect(c.any).toBe(2);
  });

  it("counts raw <button> and <input>, but not inside the primitives", () => {
    const jsx = `export const X = () => <div><button /><input /><Button /></div>;`;
    expect(count("src/app/x/page.tsx", jsx)).toMatchObject({ rawButton: 1, rawInput: 1 });
    expect(count("src/components/ui.tsx", jsx)).toMatchObject({ rawButton: 0, rawInput: 0 });
  });

  it("counts process.env outside config.ts, except NEXT_PUBLIC_* and NODE_ENV", () => {
    const text = `const a = process.env.JT_GRANT_KEY; const b = process.env.NEXT_PUBLIC_X; const c = process.env.NODE_ENV;`;
    expect(count("src/app/api/x/route.ts", text).processEnv).toBe(1);
    expect(count("src/lib/config.ts", text).processEnv).toBe(0);
  });

  it("counts a local money formatter, but not a money value or the shared one", () => {
    const text = `const money = (n: number) => "$" + n; function usd(n: number) { return n; } const dollars = 5;`;
    expect(count("src/app/x/page.tsx", text).localMoney).toBe(2);
    expect(count("src/lib/money.ts", text).localMoney).toBe(0);
  });

  it("counts hand-tinted boxes and the overridden dark border", () => {
    const text = `const k = "bg-amber-50 dark:border-neutral-600 bg-red-100 bg-amber-500";`;
    expect(count("src/app/x/page.tsx", text)).toMatchObject({ tintedBox: 2, darkBorderNeutral600: 1 });
  });

  it("marks a file over the line limit", () => {
    expect(count("src/lib/x.ts", "\n".repeat(1500)).bigFile).toBe(1);
    expect(count("src/lib/x.ts", "\n".repeat(1499)).bigFile).toBe(0);
  });
});
