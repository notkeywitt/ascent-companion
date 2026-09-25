/**
 * Whether a Sunset statement reconciles — the GREEN state on /payments.
 *
 * PURE, so the Sunset Statements page and the home card count the same
 * statements green. It used to live inline in the page's render loop.
 *
 * Two comparison bases. When the statement's own invoice list was captured, the
 * statement's printed gross is compared with the system's invoices, and the
 * early-pay discount does not enter into it. Without a captured list, the
 * statement NET (gross minus discount) is compared, which needs the discount
 * read first — until then the check is not ready. Bills flagged "Bought Back"
 * are expectedly short on the system side by `boughtBackTotal`, so it is added
 * back. A total that matches still fails on any invoice-number discrepancy:
 * a missing invoice can hide behind an offsetting extra one.
 */
export interface ReconcileStatement {
  extractedAt: string;
  net: string;
  total: string;
}

export interface ReconcileResult {
  invoiceCount: number;
  creditCount: number;
  netTotal: number;
  hasLineItems?: boolean;
  statementTotal?: number;
  boughtBackTotal?: number;
  match?: { missing: unknown[]; mismatched: unknown[]; extra: unknown[] } | null;
}

export function reconcileState(s: ReconcileStatement, rc: ReconcileResult | undefined) {
  const netKnown = !!s.extractedAt && s.net !== "" && Number.isFinite(Number(s.net));
  const hasRows = !!rc && (rc.invoiceCount > 0 || rc.creditCount > 0);
  const useLines = !!rc?.hasLineItems;
  const cmpTarget = useLines ? (rc?.statementTotal ?? 0) : netKnown ? Number(s.net) : Number(s.total);
  const cmpReady = useLines || netKnown;
  const boughtBackTotal = rc?.boughtBackTotal ?? 0;
  const diff =
    rc && cmpReady && Number.isFinite(cmpTarget)
      ? Math.round((cmpTarget - rc.netTotal - boughtBackTotal) * 100) / 100
      : null;
  const m = rc?.match ?? null;
  const matchIssues = m ? m.missing.length + m.mismatched.length + m.extra.length : 0;
  const totalMatches = hasRows && cmpReady && diff !== null && Math.abs(diff) <= 0.01;
  return {
    netKnown,
    hasRows,
    useLines,
    cmpTarget,
    cmpReady,
    boughtBackTotal,
    diff,
    matchIssues,
    totalMatches,
    reconciled: totalMatches && matchIssues === 0,
  };
}
