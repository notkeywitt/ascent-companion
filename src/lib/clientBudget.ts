/**
 * CLIENT BUDGET REPORT — the money math behind /client-budget, the printable
 * report sent with each invoice (replaces the 11×17 tracking-sheet PDF).
 *
 * Pure: no fetch. `getClientBudgetInputs` (src/lib/jobtread/clientBudget.ts)
 * reads the per-code sums; this folds them into division → code rows.
 *
 * Kept out of every row, the way the board keeps them out of its work totals:
 * the deposit (CD — shown in its own block), sales tax (88 80 00) and warranty
 * (88 90 00). Denied (voided) documents never reach the inputs.
 */
import { DEPOSIT_CSI } from "@/lib/deposits";
import { SALES_TAX_CSI } from "@/lib/salesTax";
import { WARRANTY_CSI } from "@/lib/warranty";

/** Per cost-code number. */
export type ByCode = Record<string, number>;

export interface ClientBudgetInputs {
  /** Budget at the client's price (approved customer orders, or the estimate). */
  budgetPrice: ByCode;
  /** The same budget at Ascent's cost. */
  budgetCost: ByCode;
  /** Client-invoice line price through the report month (draft, pending, approved). */
  billed: ByCode;
  /** Pending + approved vendor-bill cost through the report month. */
  bills: ByCode;
  /** Time-entry cost through the report month. */
  labor: ByCode;
  codeNames: Record<string, string>;
  /** Division ("06") → its name. */
  divisionNames: Record<string, string>;
}

export interface ClientBudgetRow {
  code: string;
  name: string;
  budget: number;
  billed: number;
  /** budget − billed. */
  remaining: number;
  /** billed ÷ budget; null when there is no budget. */
  pctInvoiced: number | null;
  costToDate: number;
  /** budget cost − cost to date. Negative only when the code is over. */
  costToComplete: number;
}

type Totals = Omit<ClientBudgetRow, "code" | "name">;

export interface ClientBudgetDivision extends Totals {
  division: string;
  name: string;
  rows: ClientBudgetRow[];
}

export interface ClientBudgetReport extends Totals {
  divisions: ClientBudgetDivision[];
}

const EXCLUDED = new Set([DEPOSIT_CSI, SALES_TAX_CSI, WARRANTY_CSI]);
const r2 = (n: number) => Math.round(n * 100) / 100;

function totalsOf(rows: Totals[], budgetCost: number): Totals {
  const sum = (k: keyof Totals) => r2(rows.reduce((s, r) => s + (r[k] ?? 0), 0));
  const budget = sum("budget");
  const billed = sum("billed");
  const costToDate = sum("costToDate");
  return {
    budget,
    billed,
    remaining: r2(budget - billed),
    pctInvoiced: budget ? billed / budget : null,
    costToDate,
    costToComplete: r2(budgetCost - costToDate),
  };
}

export function buildClientBudget(input: ClientBudgetInputs): ClientBudgetReport {
  const { budgetPrice, budgetCost, billed, bills, labor, codeNames, divisionNames } = input;
  const codes = new Set(
    [budgetPrice, budgetCost, billed, bills, labor].flatMap((m) => Object.keys(m)),
  );

  const divisions = new Map<string, { rows: ClientBudgetRow[]; budgetCost: number }>();
  for (const code of codes) {
    if (EXCLUDED.has(code)) continue;
    const budget = r2(budgetPrice[code] ?? 0);
    const bc = r2(budgetCost[code] ?? 0);
    const b = r2(billed[code] ?? 0);
    const costToDate = r2((bills[code] ?? 0) + (labor[code] ?? 0));
    if (!budget && !bc && !b && !costToDate) continue;
    const digits = code.replace(/\D/g, "");
    const division = digits ? digits.slice(0, 2) : "—";
    let d = divisions.get(division);
    if (!d) divisions.set(division, (d = { rows: [], budgetCost: 0 }));
    d.budgetCost += bc;
    d.rows.push({
      code,
      name: codeNames[code] ?? "",
      budget,
      billed: b,
      remaining: r2(budget - b),
      pctInvoiced: budget ? b / budget : null,
      costToDate,
      costToComplete: r2(bc - costToDate),
    });
  }

  const out: ClientBudgetDivision[] = [...divisions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([division, d]) => ({
      division,
      name: divisionNames[division] ?? "",
      rows: d.rows.sort((a, b) => a.code.localeCompare(b.code)),
      ...totalsOf(d.rows, d.budgetCost),
    }));
  const allBudgetCost = [...divisions.values()].reduce((s, d) => s + d.budgetCost, 0);
  return { divisions: out, ...totalsOf(out, allBudgetCost) };
}
