import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The parts of the JobTread client import each other in loops. A loop is safe
 * only while no part reads another part's VALUE at load time (outside a
 * function body). In production that read throws "Cannot access before
 * initialization" and takes every route down with it. Vitest's loader hands
 * back `undefined` instead of throwing, so loading the files here proves
 * nothing: this test reads the source instead.
 *
 * The rule: a value read at load time comes from core.ts, and core.ts imports
 * no other part.
 */
const parts = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const source = (f: string) => readFileSync(join(__dirname, f), "utf8");

/** Names a part imports as values from a sibling part other than core. */
function siblingValueImports(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.importClause?.isTypeOnly) continue;
    const from = (st.moduleSpecifier as ts.StringLiteral).text;
    if (!from.startsWith("./") || from === "./core") continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb))
      for (const el of nb.elements) if (!el.isTypeOnly) names.add(el.name.text);
  }
  return names;
}

/** Sibling values a part reads at load time: in top-level code, outside any function. */
function loadTimeReads(f: string): string[] {
  const sf = ts.createSourceFile(f, source(f), ts.ScriptTarget.Latest, true);
  const imported = siblingValueImports(sf);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return; // runs later, not at load
    if (ts.isTypeNode(node)) return;
    if (
      ts.isIdentifier(node) &&
      imported.has(node.text) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    )
      hits.push(`${f}: ${node.text}`);
    ts.forEachChild(node, visit);
  };
  for (const st of sf.statements) if (!ts.isImportDeclaration(st)) visit(st);
  return hits;
}

describe("jobtread parts are safe to load in any order", () => {
  it("core imports no other part", () => {
    expect(source("core.ts")).not.toMatch(/from "\.\//);
  });

  it.each(parts)("%s reads no other part's value at load time (move it to core.ts)", (f) => {
    expect(loadTimeReads(f)).toEqual([]);
  });

  it("the barrel loads", async () => {
    const m = await import("@/lib/jobtread");
    expect(typeof m.pave).toBe("function");
    expect(typeof m.getAllBillsForMonth).toBe("function");
  });
});
