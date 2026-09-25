/**
 * The facts the home page's reminders and card counts are built on — "the last
 * month Amazon was imported", "how many Sunset statements are green". CLIENT
 * module: each fact reads an endpoint its own page already uses.
 *
 * Two surfaces read the same fact (the Amazon reminder under the date AND the
 * Amazon Import row on its card), so every fact goes through `cached`: one
 * request per fact, shared, and kept for its TTL in this tab. Some are slow —
 * the Sunset reconcile is a 10-20s Apps Script run — and the home page is
 * opened many times a day.
 */
import { companyDateParts } from "@/lib/billing";
import { gatewayQuery } from "@/lib/paveGatewayClient";
import { reconcileState, type ReconcileResult } from "@/lib/sunsetReconcile";

const MIN = 60_000;
const held = new Map<string, { at: number; p: Promise<unknown> }>();

/** One shared, TTL-bounded load per key — in memory, and in sessionStorage across reloads. */
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = held.get(key);
  if (hit && now - hit.at < ttlMs) return hit.p as Promise<T>;
  const storeKey = `home.fact.${key}`;
  try {
    const raw = sessionStorage.getItem(storeKey);
    if (raw) {
      const { at, v } = JSON.parse(raw) as { at: number; v: T };
      if (now - at < ttlMs) {
        const p = Promise.resolve(v);
        held.set(key, { at, p });
        return p;
      }
    }
  } catch {
    /* storage blocked — load it */
  }
  const p = load().then((v) => {
    try {
      sessionStorage.setItem(storeKey, JSON.stringify({ at: Date.now(), v }));
    } catch {
      /* the in-memory copy still serves this visit */
    }
    return v;
  });
  // A failure is not remembered: the next caller tries again.
  p.catch(() => held.delete(key));
  held.set(key, { at: now, p });
  return p;
}

/** "YYYY-MM" of the month before today, in the company timezone. */
export function previousMonth(now = new Date()): string {
  const { year, month } = companyDateParts(now);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * The newest month an Amazon import filed bills into, "YYYY-MM", or "" for
 * never. The import files each order on the LAST day of its billing month and
 * ids it `AMZ-<order>`, so the newest such bill's issue date names the month.
 * A voided (denied) bill does not count. Pave cannot filter on externalId, so
 * the newest Amazon bills are read and the id is checked here.
 */
export function lastAmazonMonth(): Promise<string> {
  return cached("amazon", 10 * MIN, async () => {
    type R = {
      currentGrant: {
        organization: {
          documents: { nodes: { issueDate?: string; externalId?: string; status?: string }[] };
        };
      };
    };
    const r = await gatewayQuery<R>({
      currentGrant: {
        organization: {
          documents: {
            $: {
              size: 50,
              where: {
                and: [
                  { "=": [{ field: "type" }, { value: "vendorBill" }] },
                  { like: [{ field: ["account", "name"] }, { value: "%Amazon%" }] },
                ],
              },
              sortBy: [{ field: "issueDate", order: "desc" }],
            },
            nodes: { issueDate: {}, externalId: {}, status: {} },
          },
        },
      },
    });
    const bill = r.currentGrant.organization.documents.nodes.find(
      (d) => (d.externalId ?? "").startsWith("AMZ-") && d.status !== "denied",
    );
    return (bill?.issueDate ?? "").slice(0, 7);
  });
}

/**
 * The newest month of LSWDD dump charges that has been dealt with — pushed to
 * JobTread or deliberately dismissed on /lswdd — "YYYY-MM", or "" for never.
 * Read by charge date, so September's statement (which arrives in October)
 * counts as September.
 */
export function lastLswddMonth(): Promise<string> {
  return cached("lswdd", 30 * MIN, async () => {
    const r = await fetch("/api/lswdd?includePushed=1");
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as {
      statements?: { lines?: { chargeDate?: string; status?: string }[] }[];
    };
    let last = "";
    for (const st of j.statements ?? [])
      for (const l of st.lines ?? [])
        if (l.status && l.status !== "Staged" && (l.chargeDate ?? "") > last)
          last = l.chargeDate ?? "";
    return last.slice(0, 7);
  });
}

/** Unpaid Sunset statements, split by the /payments green (reconciled) test. */
export function sunsetGreenCounts(): Promise<{ green: number; notGreen: number }> {
  return cached("sunset", 15 * MIN, async () => {
    const [list, recon] = await Promise.all([
      fetch("/api/sunset-statements?status=unpaid").then((r) => r.json()),
      fetch("/api/sunset-statements/reconcile").then((r) => r.json()),
    ]);
    if (list?.error || recon?.ok === false) throw new Error("sunset read failed");
    const rcBy = (recon.reconciliation ?? {}) as Record<string, ReconcileResult>;
    const rows = (list.items ?? []) as {
      expId: string;
      extractedAt: string;
      net: string;
      total: string;
    }[];
    const green = rows.filter((s) => reconcileState(s, rcBy[s.expId]).reconciled).length;
    return { green, notGreen: rows.length - green };
  });
}
