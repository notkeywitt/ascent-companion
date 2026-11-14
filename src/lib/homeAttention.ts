import { NextRequest } from "next/server";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { featureRequests } from "@/db/schema";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { list as listFindings } from "@/lib/findings";
import { refreshSources } from "@/lib/findingSources";
import { monthLabel } from "@/lib/billingMonths";
import { previousMonth } from "@/lib/homeFacts";
import { getAllDraftBills, getLastAmazonBillMonth } from "@/lib/jobtread";
import { listRequests } from "@/lib/leaveService";
import { reconcileState, type ReconcileResult } from "@/lib/sunsetReconcile";
import { listTimeProblems } from "@/lib/timeSync";
import { resolveAllowedViews } from "@/lib/views";
import { GET as sunsetList } from "@/app/api/sunset-statements/route";
import { GET as sunsetReconcile } from "@/app/api/sunset-statements/reconcile/route";

/**
 * NEEDS ATTENTION — every queue waiting on the reader, counted on the server in
 * one request (/api/attention). Home's count and TodayQueue both read it.
 *
 * Phase 5 of OVERHAUL_PLAN replaces this with the findings inbox. Swap
 * `loadAttention` and keep the row shape; nothing else reads the queues.
 *
 * Each source is gated by the view whose page its row opens, checked here
 * because no middleware sits between this function and the reads. A source
 * that fails or runs past TIMEOUT_MS is left out: no row is the honest answer
 * to "could not check".
 */

export interface AttentionRow {
  key: string;
  label: string;
  href: string;
  count: number;
  detail: string;
  /** Requisitions only: the open ReqIDs, so the browser can count the ones
   *  this device has not seen (lib/requisitionsSeen keeps that per device). */
  ids?: string[];
}

const TIMEOUT_MS = 8_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Source = {
  key: string;
  view: string;
  /** Office and admin only: a count of everyone's items is office work. */
  officeOnly?: boolean;
  label: string;
  href: string;
  load: (email: string) => Promise<Omit<AttentionRow, "key" | "label" | "href">>;
};

const SOURCES: Source[] = [
  {
    // The findings inbox (lib/findings). When every queue below reports into
    // the store, this row is the whole list: delete the others.
    key: "findings",
    view: "attention",
    label: "Warnings",
    href: "/attention",
    load: async (email) => {
      await refreshSources();
      const n = (await listFindings({ reader: email })).length;
      return { count: n, detail: `${plural(n, "open warning")}` };
    },
  },
  {
    key: "drafts",
    view: "recode",
    label: "Bills to code",
    href: "",
    load: async () => {
      if (!hasGrant()) throw new Error("no grant");
      const bills = await getAllDraftBills(getPaveConfig());
      // By id: two customers each have a "Main House".
      const jobs = new Set(bills.map((b) => b.jobId || b.jobName || "No job")).size;
      return { count: bills.length, detail: `${plural(bills.length, "draft bill")} on ${plural(jobs, "job")}` };
    },
  },
  {
    key: "to-log",
    view: "email",
    officeOnly: true,
    label: "Invoices to log",
    href: "/email",
    load: async () => {
      const r = await callAppsScript<{ ok?: boolean; emails?: unknown[]; error?: string }>({ action: "listEmails" });
      if (r.error || !r.data?.ok) throw new Error(r.error || r.data?.error || "listEmails failed");
      const n = (r.data.emails ?? []).length;
      return { count: n, detail: `${plural(n, "invoice email")} to log` };
    },
  },
  {
    key: "time-sync",
    view: "time-sync",
    label: "Time Sync",
    href: "/payroll?section=sync",
    load: async () => {
      const n = (await listTimeProblems()).problems;
      return { count: n, detail: `${plural(n, "time record")} JobTread does not have right` };
    },
  },
  {
    key: "time-off",
    view: "time-off-admin",
    label: "Time off to approve",
    href: "/payroll?section=timeoff",
    load: async () => {
      const n = (await listRequests({})).filter((r) => r.status === "pending").length;
      return { count: n, detail: `${plural(n, "request")} waiting` };
    },
  },
  {
    key: "requisitions",
    view: "requisitions",
    officeOnly: true,
    label: "Requisitions",
    href: "/requisitions?status=Requested",
    load: async (email) => {
      const r = await callAppsScript<{ requisitions?: Record<string, string>[]; error?: string }>({
        action: "listRequisitions",
        requesterEmail: email,
        status: "",
        job: "",
      });
      if (r.error || r.data?.error) throw new Error(r.error || r.data?.error);
      const open = (r.data?.requisitions ?? []).filter((x) => !x.Status || x.Status === "Requested");
      return { count: open.length, detail: `${plural(open.length, "request")} to order`, ids: open.map((x) => x.ReqID ?? "") };
    },
  },
  {
    key: "sunset",
    view: "payments",
    officeOnly: true,
    label: "Sunset",
    href: "/payments",
    // The two routes the Payments page reads, called in process: the list
    // route also refreshes the statement cache, and that logic lives there.
    load: async () => {
      const [list, recon] = await Promise.all([
        sunsetList(new NextRequest("http://local/api/sunset-statements?status=unpaid")).then((r) => r.json()),
        sunsetReconcile().then((r) => r.json()),
      ]);
      if (list?.error || recon?.ok === false) throw new Error("sunset read failed");
      const rcBy = (recon.reconciliation ?? {}) as Record<string, ReconcileResult>;
      const rows = (list.items ?? []) as { expId: string; extractedAt: string; net: string; total: string }[];
      const n = rows.filter((s) => !reconcileState(s, rcBy[s.expId]).reconciled).length;
      return { count: n, detail: `${plural(n, "unpaid statement")} not reconciled` };
    },
  },
  {
    // Month-end imports nothing else announces (were the masthead reminders).
    key: "amazon",
    view: "amazon-import",
    label: "Amazon import",
    href: "/amazon-import",
    load: async () => {
      const prev = previousMonth();
      const last = hasGrant() ? await getLastAmazonBillMonth(getPaveConfig()) : prev;
      return last < prev ? { count: 1, detail: `Import Amazon for ${monthLabel(prev)}` } : { count: 0, detail: "" };
    },
  },
  {
    key: "lswdd",
    view: "lswdd",
    label: "LSWDD import",
    href: "/lswdd",
    // Dealt with = pushed to JobTread or dismissed; read by charge date, so
    // September's statement (arriving in October) counts as September.
    load: async () => {
      const prev = previousMonth();
      const r = await callAppsScript<{ statements?: { lines?: { chargeDate?: string; status?: string }[] }[]; error?: string }>(
        { action: "lswddList", includePushed: true },
      );
      if (r.error || r.data?.error) throw new Error(r.error || r.data?.error);
      let last = "";
      for (const st of r.data?.statements ?? [])
        for (const l of st.lines ?? [])
          if (l.status && l.status !== "Staged" && (l.chargeDate ?? "") > last) last = l.chargeDate ?? "";
      return last.slice(0, 7) < prev ? { count: 1, detail: `Import LSWDD for ${monthLabel(prev)}` } : { count: 0, detail: "" };
    },
  },
  {
    key: "feedback",
    view: "requests",
    officeOnly: true,
    label: "App Feedback",
    href: "/requests",
    load: async () => {
      await ensureDb();
      const rows = await db.select({ status: featureRequests.status }).from(featureRequests);
      const n = rows.filter((r) => r.status === "open").length;
      return { count: n, detail: `${plural(n, "request")} open` };
    },
  },
];

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);
}

/** The reader's queues with something in them, in SOURCES order. */
export async function loadAttention(): Promise<AttentionRow[]> {
  const user = (await auth())?.user;
  if (!user || user.revoked) return [];
  const views = resolveAllowedViews(user.role, user.viewsAllow, user.viewsDeny, user.roleBase);
  const office = user.role === "admin" || user.role === "office";
  const email = user.email ?? "";
  const mine = SOURCES.filter((s) => views.has(s.view) && (!s.officeOnly || office));
  const settled = await Promise.allSettled(mine.map((s) => withTimeout(s.load(email))));
  return mine.flatMap((s, i) => {
    const r = settled[i];
    if (r.status !== "fulfilled" || r.value.count <= 0) return [];
    return [{ key: s.key, label: s.label, href: s.href, ...r.value }];
  });
}
