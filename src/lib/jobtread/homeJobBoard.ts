// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { splitAddresses } from "@/lib/vendorMail";
import type { JobVendor, JtSpec } from "@/lib/houseManual";
import { type JobBoardCard, type ScheduleTask, spanPct, byWindow, type JobGanttData, type GanttBar } from "@/lib/jobBoard";
import { _jobCostKey, cachedRef, NOT_DEPOSIT_LINE, pageAll, pageEach, pave, type PaveConfig } from "./core";
import { CTC_ACTUAL_WHERE, CTC_BUDGET_WHERE } from "./codingQueue";
import { getJobPhaseMap, getJobs } from "./jobCostDetail";
import { type BillType, CF_COST_CODES } from "./billIngestion";
import { jtIsoToOrgLocal } from "./timeEntries";
// ---------------------------------------------------------------------------
// HOME JOB BOARD — every active job's budget + Gantt position, in ONE call
// ---------------------------------------------------------------------------

/**
 * One card per active job for the home board: budget, actuals, and where the
 * job sits on JobTread's own calendar/Gantt chart.
 *
 * ONE Pave request does the lot, because every part of it is an org-wide
 * aggregate that JobTread can sum itself (confirmed live 2026-09-06). The
 * aliased connections are:
 *   budgetByJob  Σ approved, includeInBudget customerOrder lines  = Budgeted Cost
 *   priceByJob   the same lines at price                           = Approved Price
 *   leafByJob    Σ budget leaves (document == null) — the fallback basis, for the
 *                8-of-24 jobs whose budget was never issued as a customer order
 *   leafPriceByJob  the same leaves at price
 *   invoicedByJob   Σ approved + pending customerInvoice lines at price. Before
 *                tax, so it compares with the price; JobTread's "Invoiced"
 *                figure includes tax and reads higher.
 *   billsByJob   Σ approved + pending vendorBill lines            = spend
 *   laborByJob   Σ time-entry cost                                = labor
 *   spanByJob    min startDate / max endDate over the job's schedule tasks
 *   nowTasks     the tasks whose window covers today
 *   nextTasks    the tasks starting after today, earliest first
 * The `_` alias is what lets one query read the same connection under several
 * filters (JT_API_REFERENCE.md, "FIELD ALIAS").
 *
 * ponytail: single page per aggregate (size 100). The org has ~30 jobs, so the
 * group pages fit; past 100 jobs with schedules, page the `withValues`.
 */
export function getJobBoard(cfg: PaveConfig): Promise<JobBoardCard[]> {
  return cachedRef(`jobboard:${cfg.orgId}`, 5 * 60_000, () => _getJobBoardUncached(cfg));
}

// Both leave deposit lines out (NOT_DEPOSIT_LINE): a CD budget leaf carries the
// deposit amount (Ferron's $123,000), which is not contract price, and a CD
// invoice line is a deposit billed or drawn, not work invoiced.
export const BOARD_LEAF_WHERE = {
  and: [{ "=": [{ field: ["document", "id"] }, { value: null }] }, NOT_DEPOSIT_LINE],
};
export const BOARD_INVOICED_WHERE = {
  and: [
    [["document", "type"], "customerInvoice"],
    { in: [{ field: ["document", "status"] }, [{ value: "approved" }, { value: "pending" }]] },
    NOT_DEPOSIT_LINE,
  ],
};
export const BOARD_TASK_WHERE = [["isToDo", false], { "!=": [{ field: ["job", "id"] }, { value: null }] }];

export async function _getJobBoardUncached(cfg: PaveConfig): Promise<JobBoardCard[]> {
  const today = jtIsoToOrgLocal(new Date().toISOString()).slice(0, 10);
  const groupByJob = (where: unknown, sum: "cost" | "price" = "cost") => ({
    _: "costItems",
    $: { size: 100, where, group: { by: [["job", "id"]], aggs: { total: { sum } } } },
    withValues: {},
  });
  const taskNodes = { name: {}, startDate: {}, endDate: {}, job: { id: {} } };

  const [jobs, phases, r] = await Promise.all([
    getJobs(cfg),
    getJobPhaseMap(cfg),
    pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        id: {},
        budgetByJob: groupByJob(CTC_BUDGET_WHERE),
        priceByJob: groupByJob(CTC_BUDGET_WHERE, "price"),
        leafByJob: groupByJob(BOARD_LEAF_WHERE),
        leafPriceByJob: groupByJob(BOARD_LEAF_WHERE, "price"),
        invoicedByJob: groupByJob(BOARD_INVOICED_WHERE, "price"),
        billsByJob: groupByJob(CTC_ACTUAL_WHERE),
        laborByJob: {
          _: "timeEntries",
          $: { size: 100, group: { by: [["job", "id"]], aggs: { total: { sum: "cost" } } } },
          withValues: {},
        },
        spanByJob: {
          _: "tasks",
          $: {
            size: 100,
            where: {
              and: [...BOARD_TASK_WHERE, { "!=": [{ field: "endDate" }, { value: null }] }],
            },
            group: {
              by: [["job", "id"]],
              aggs: { start: { min: "startDate" }, end: { max: "endDate" } },
            },
          },
          withValues: {},
        },
        nowTasks: {
          _: "tasks",
          $: {
            size: 100,
            where: {
              and: [
                ...BOARD_TASK_WHERE,
                { "<=": [{ field: "startDate" }, { value: today }] },
                { ">=": [{ field: "endDate" }, { value: today }] },
              ],
            },
            sortBy: [{ field: "startDate", order: "asc" }],
          },
          nodes: taskNodes,
        },
        nextTasks: {
          _: "tasks",
          $: {
            size: 100,
            where: {
              and: [...BOARD_TASK_WHERE, { ">": [{ field: "startDate" }, { value: today }] }],
            },
            sortBy: [{ field: "startDate", order: "asc" }],
          },
          nodes: taskNodes,
        },
      },
    }),
  ]);

  const org = r?.organization ?? {};
  /** A grouped `withValues` row set → { jobId: total }. */
  const totals = (conn: any): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of conn?.withValues ?? []) {
      const id = row?.job?.id;
      if (id) out[id] = (out[id] ?? 0) + (row.total ?? 0);
    }
    return out;
  };
  const budgets = totals(org.budgetByJob);
  const leaves = totals(org.leafByJob);
  const prices = totals(org.priceByJob);
  const leafPrices = totals(org.leafPriceByJob);
  const invoiced = totals(org.invoicedByJob);
  const bills = totals(org.billsByJob);
  const labor = totals(org.laborByJob);

  const spans: Record<string, { start: string; end: string }> = {};
  for (const row of org.spanByJob?.withValues ?? []) {
    const id = row?.job?.id;
    if (id && row.start && row.end) spans[id] = { start: row.start, end: row.end };
  }
  /** Schedule tasks per job, in the order JobTread returned them (startDate asc). */
  const tasksByJob = (conn: any): Record<string, ScheduleTask[]> => {
    const out: Record<string, ScheduleTask[]> = {};
    for (const n of conn?.nodes ?? []) {
      const id = n?.job?.id;
      if (!id || !n.startDate || !n.endDate) continue;
      (out[id] ??= []).push({ name: n.name || "(untitled)", start: n.startDate, end: n.endDate });
    }
    return out;
  };
  const now = tasksByJob(org.nowTasks);
  const next = tasksByJob(org.nextTasks);

  return jobs.map((j) => {
    const budget = budgets[j.id] ?? 0;
    const leaf = leaves[j.id] ?? 0;
    const span = spans[j.id];
    return {
      id: j.id,
      name: j.name,
      customer: j.customer ?? "",
      phase: phases[j.id] ?? null,
      // Same rule as getJobCostDetail: no approved customer order means the
      // budget IS the base estimate, or there is no budget at all.
      budget: budget || leaf,
      budgetBasis: budget ? "orders" : leaf ? "leaves" : "none",
      price: budget ? (prices[j.id] ?? 0) : (leafPrices[j.id] ?? 0),
      invoiced: invoiced[j.id] ?? 0,
      bills: bills[j.id] ?? 0,
      labor: labor[j.id] ?? 0,
      schedule: span
        ? {
            start: span.start,
            end: span.end,
            pctElapsed: spanPct(span.start, span.end, today),
            now: byWindow(now[j.id] ?? []),
            next: (next[j.id] ?? [])[0] ?? null,
          }
        : null,
    };
  });
}

/**
 * One job's Gantt chart, as JobTread draws it: the schedule GROUPS (phases),
 * their dates and their progress, plus the span every bar is measured against.
 *
 * Groups only — `isGroup` is JobTread's own parent-bar flag, and a job carries
 * ~15 of them against ~110 leaf tasks (Bunkhouse, 2026-09-06). 15 bars is a
 * chart; 110 is a wall. The leaf task in flight today is already named on the
 * card's schedule line, and the Tracking Sheet has the rest.
 */
export function getJobGantt(cfg: PaveConfig, jobId: string): Promise<JobGanttData | null> {
  return cachedRef(_jobCostKey("gantt", cfg.orgId, jobId), 5 * 60_000, () =>
    _getJobGanttUncached(cfg, jobId),
  );
}
export async function _getJobGanttUncached(cfg: PaveConfig, jobId: string): Promise<JobGanttData | null> {
  const bars: GanttBar[] = [];
  await pageEach<any>(
    cfg,
    {
      label: "organization.tasks (job Gantt)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          tasks: {
            $: {
              where: {
                and: [
                  ["isToDo", false],
                  ["isGroup", true],
                  [["job", "id"], jobId],
                  { "!=": [{ field: "startDate" }, { value: null }] },
                  { "!=": [{ field: "endDate" }, { value: null }] },
                ],
              },
              sortBy: [{ field: "startDate", order: "asc" }],
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              startDate: {},
              endDate: {},
              progress: {},
              parentTask: { id: {} },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.tasks,
    },
    (rows) => {
      for (const n of rows) {
        if (!n?.startDate || !n?.endDate) continue;
        bars.push({
          id: n.id,
          name: n.name || "(untitled)",
          start: n.startDate,
          end: n.endDate,
          progress: typeof n.progress === "number" ? n.progress : null,
          depth: n.parentTask?.id ? 1 : 0,
        });
      }
    },
  );
  if (bars.length === 0) return null;
  return {
    start: bars.reduce((min, b) => (b.start < min ? b.start : min), bars[0].start),
    end: bars.reduce((max, b) => (b.end > max ? b.end : max), bars[0].end),
    bars,
  };
}

/** The job a member last logged time to — "the job you're on" for a lead. */
export async function getLatestJobForUser(cfg: PaveConfig, userId: string): Promise<string | null> {
  if (!userId) return null;
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      timeEntries: {
        $: {
          size: 1,
          sortBy: [{ field: "startedAt", order: "desc" }],
          where: [["user", "id"], userId],
        },
        nodes: { job: { id: {} } },
      },
    },
  });
  return r?.organization?.timeEntries?.nodes?.[0]?.job?.id ?? null;
}

export interface VendorRef {
  id: string;
  name: string;
}

/** Org's vendor accounts (for the RFI assignee dropdown), sorted by name. */
export function getVendors(cfg: PaveConfig): Promise<VendorRef[]> {
  return cachedRef(`vendors:${cfg.orgId}`, 30 * 60_000, () => _getVendorsUncached(cfg));
}
export async function _getVendorsUncached(cfg: PaveConfig): Promise<VendorRef[]> {
  const nodes = await pageAll<any>(cfg, {
    label: "organization.accounts (vendors)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        accounts: {
          $: { where: { and: [["type", "vendor"]] }, sortBy: [{ field: "name" }], ...args },
          nextPage: {},
          nodes: { id: {}, name: {} },
        },
      },
    }),
    pick: (r) => r?.organization?.accounts,
  });
  return nodes.map((n) => ({ id: n.id, name: n.name }));
}

/**
 * vendor account id → its street address(es), for the header search box.
 *
 * A vendor's address is a JobTread Location on its account, the same record a
 * job's address lives on. Few vendors have one (2 of ~238, checked live
 * 2026-11-02), so this pages `organization.locations` filtered to vendor
 * accounts rather than nesting locations inside the accounts walk (the 413
 * rule). `formattedAddress` is Google's normalized form; a location Google
 * never resolved has only the typed `address`. A vendor with two locations
 * gets both, joined with "; ".
 */
export function getVendorAddresses(cfg: PaveConfig): Promise<Record<string, string>> {
  return cachedRef(`vendoraddresses:${cfg.orgId}`, 30 * 60_000, () => _getVendorAddressesUncached(cfg));
}
export async function _getVendorAddressesUncached(cfg: PaveConfig): Promise<Record<string, string>> {
  const nodes = await pageAll<any>(cfg, {
    label: "organization.locations (vendors)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        locations: {
          $: { where: [["account", "type"], "vendor"], ...args },
          nextPage: {},
          nodes: { id: {}, address: {}, formattedAddress: {}, account: { id: {} } },
        },
      },
    }),
    pick: (r) => r?.organization?.locations,
  });
  const out: Record<string, string> = {};
  for (const n of nodes) {
    const id = n?.account?.id;
    const addr = String(n?.formattedAddress || n?.address || "").trim();
    if (!id || !addr) continue;
    out[id] = out[id] ? `${out[id]}; ${addr}` : addr;
  }
  return out;
}

/** A vendor account plus every address its JobTread Email field holds. */
export interface VendorEmailRow {
  id: string;
  name: string;
  /** Raw field value, as the office typed it — what the editor round-trips. */
  email: string;
  /** The addresses parsed out of it, normalized for matching. */
  addresses: string[];
}

/**
 * Every vendor account with the addresses on file — the index the vendor-mail
 * sweep searches by, and the coverage number it reports.
 *
 * Two phases, per the 413 rule: nesting `customFieldValues` inside the paged
 * `organization.accounts` connection returns HTTP 413, so the Email field is
 * looked up once by name and its VALUES are paged, each carrying the account it
 * belongs to. Same inversion as `getJobPhaseMap`, confirmed live 2026-09-23:
 * 238 vendor accounts, 102 with an address.
 *
 * Vendors WITHOUT an address are returned too, with `addresses: []`. They are
 * the blind spot the page has to show — a vendor nobody indexed cannot be
 * searched for, and the list would look clean whether or not they sent anything.
 */
export function getVendorEmails(cfg: PaveConfig): Promise<VendorEmailRow[]> {
  return cachedRef(`vendoremails:${cfg.orgId}`, 30 * 60_000, () => _getVendorEmailsUncached(cfg));
}
export async function _getVendorEmailsUncached(cfg: PaveConfig): Promise<VendorEmailRow[]> {
  const vendors = await getVendors(cfg);
  const byId = new Map<string, VendorEmailRow>(
    vendors.map((v) => [v.id, { id: v.id, name: v.name, email: "", addresses: [] }]),
  );

  const cf = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, targetType: {} } },
    },
  });
  const fields: any[] = cf?.organization?.customFields?.nodes ?? [];
  const field =
    fields.find((f) => f?.name === "Email" && f?.targetType === "vendor") ??
    fields.find((f) => f?.name === "Email");
  // No Email field configured: every vendor reads as un-indexed, which is the
  // honest answer — the sweep can search for nobody.
  if (!field?.id) return [...byId.values()];

  await pageEach<any>(
    cfg,
    {
      label: "customField.customFieldValues (vendor Email)",
      query: (args) => ({
        customField: {
          $: { id: field.id },
          id: {},
          customFieldValues: { $: args, nextPage: {}, nodes: { value: {}, account: { id: {} } } },
        },
      }),
      pick: (r) => r?.customField?.customFieldValues,
    },
    (rows) => {
      for (const n of rows) {
        const id = n?.account?.id;
        const row = id ? byId.get(id) : undefined;
        if (!row || n?.value == null) continue;
        const raw = String(n.value).trim();
        if (!raw) continue;
        row.email = raw;
        row.addresses = splitAddresses(raw);
      }
    },
  );
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One vendor's COI fields, as `getVendorCoiFields` returns them. */
export interface VendorCoiFields {
  /** "YYYY-MM-DD", or "" when unset. */
  coiExpires: string;
  /** Subcontractor, Supplier, Rentals, Other, or "". */
  vendorType: string;
}

/**
 * Every vendor's "COI Expires" date and "Type" option, keyed by account id.
 * A vendor with neither is absent.
 *
 * Same inversion as `getVendorEmails`: the field is looked up by name and its
 * VALUES are paged, each carrying its account. Nesting `customFieldValues` in
 * the paged `organization.accounts` connection returns HTTP 413.
 */
export function getVendorCoiFields(cfg: PaveConfig): Promise<Record<string, VendorCoiFields>> {
  return cachedRef(`vendorcoi:${cfg.orgId}`, 10 * 60_000, () => _getVendorCoiFieldsUncached(cfg));
}
export async function _getVendorCoiFieldsUncached(
  cfg: PaveConfig,
): Promise<Record<string, VendorCoiFields>> {
  const cf = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, targetType: {} } },
    },
  });
  const fields: any[] = cf?.organization?.customFields?.nodes ?? [];
  const fieldId = (name: string) =>
    String(fields.find((f) => f?.name === name && f?.targetType === "vendor")?.id ?? "");
  const out: Record<string, VendorCoiFields> = {};
  const slot = (id: string) => (out[id] ??= { coiExpires: "", vendorType: "" });
  for (const [name, key] of [
    ["COI Expires", "coiExpires"],
    ["Type", "vendorType"],
  ] as const) {
    const id = fieldId(name);
    if (!id) continue;
    await pageEach<any>(
      cfg,
      {
        label: `customField.customFieldValues (vendor ${name})`,
        query: (args) => ({
          customField: {
            $: { id },
            id: {},
            customFieldValues: { $: args, nextPage: {}, nodes: { value: {}, account: { id: {} } } },
          },
        }),
        pick: (r) => r?.customField?.customFieldValues,
      },
      (rows) => {
        for (const n of rows) {
          const acct = n?.account?.id;
          const v = n?.value == null ? "" : String(n.value).trim();
          if (!acct || !v) continue;
          slot(String(acct))[key] = key === "coiExpires" ? v.slice(0, 10) : v;
        }
      },
    );
  }
  return out;
}

export interface VendorBillRow {
  id: string;
  number: number | null;
  jobId: string | null;
  jobName: string;
  cost: number;
  status: string;
  issueDate: string | null;
}

/**
 * One vendor's bills — job, date, amount, status — newest issueDate first.
 * JobTread's own vendor search only lists a bill's number; this is the list
 * behind it, for the /vendors page.
 *
 * Confirmed live (2026-08): `account.documents` supports the same
 * `["type","vendorBill"]` filter used elsewhere in this file, `sortBy
 * issueDate desc` runs server-side, and `job` is a plain reference (not a
 * heavy nested connection) so it carries no 413 risk even for a high-volume
 * vendor like Sunset.
 */
export async function getVendorBills(cfg: PaveConfig, accountId: string): Promise<VendorBillRow[]> {
  const out = await pageAll<any>(cfg, {
    label: "account.documents (one vendor's bills)",
    query: (args) => ({
      account: {
        $: { id: accountId },
        id: {},
        documents: {
          $: {
            where: { and: [["type", "vendorBill"]] },
            sortBy: [{ field: "issueDate", order: "desc" }],
            ...args,
          },
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            cost: {},
            status: {},
            issueDate: {},
            job: { id: {}, name: {} },
          },
        },
      },
    }),
    pick: (r) => r?.account?.documents,
  });
  return out.map((b) => ({
    id: b.id,
    number: typeof b?.number === "number" ? b.number : null,
    jobId: b?.job?.id ?? null,
    jobName: b?.job?.name ?? "—",
    cost: typeof b?.cost === "number" ? b.cost : 0,
    status: b?.status ?? "",
    issueDate: b?.issueDate ?? null,
  }));
}

export interface VendorContact {
  name: string;
  title: string;
  email: string;
  phone: string;
}

export interface VendorDetail {
  id: string;
  name: string;
  /** The account's own Email / Phone custom fields (targetType `vendor`). */
  email: string;
  phone: string;
  /** The vendor's "Bill Type" custom field — what /add-bill files its bills as
   *  unless the upload picks otherwise. Unset, or no such field, reads "Bill". */
  billType: BillType;
  /** The "COI Expires" date custom field, "YYYY-MM-DD", or "" when unset. */
  coiExpires: string;
  /** The "Type" option field: Subcontractor, Supplier, Rentals, Other, or "". */
  vendorType: string;
  /** One line per location, JobTread's own `address` string — `formattedAddress`
   *  is null on a vendor address typed by hand, which most of these are. */
  addresses: string[];
  /** People on the account, each with their own Email / Phone custom fields
   *  (targetType `vendorContact`). Some vendors carry the contact's details and
   *  nothing on the account itself, so both are shown. */
  contacts: VendorContact[];
}

/** One custom-field value node → [field name, value as text]. */
export function cfPair(n: any): [string, string] {
  const name = String(n?.customField?.name ?? "");
  const v = n?.value;
  return [name, v == null || typeof v === "boolean" ? "" : String(v).trim()];
}

/**
 * One vendor's contact details — the account's Email / Phone, its addresses,
 * and each contact with their own Email / Phone.
 *
 * Email and phone are CUSTOM FIELDS in this org, not scalars: `vendor` for the
 * account, `vendorContact` for a person (confirmed live 2026-09-14). A vendor
 * may carry either, or both, or neither — Glacier Window has them only on the
 * contact, HOBI Plumbing only on the account.
 *
 * `account(id)` is a single record, so nesting `customFieldValues` is safe on
 * the account itself. Inside `contacts` it rides a PAGED connection, which is
 * the 413 shape — held to size 10 here (probed live at the sizes shipped; the
 * org's busiest vendor has 2 contacts).
 */
export async function getVendorDetail(cfg: PaveConfig, accountId: string): Promise<VendorDetail> {
  const CF = { $: { size: 20 }, nodes: { value: {}, customField: { name: {} } } };
  const r = await pave(cfg, {
    account: {
      $: { id: accountId },
      id: {},
      name: {},
      customFieldValues: CF,
      contacts: {
        $: { size: 10 },
        nodes: { id: {}, name: {}, title: {}, customFieldValues: CF },
      },
      locations: { $: { size: 10 }, nodes: { address: {}, formattedAddress: {} } },
    },
  });
  const a = r?.account;
  if (!a?.id) throw new Error(`Vendor ${accountId} not found in JobTread.`);

  const own = new Map<string, string>(((a.customFieldValues?.nodes ?? []) as any[]).map(cfPair));
  return {
    id: String(a.id),
    name: String(a.name ?? ""),
    email: own.get("Email") ?? "",
    phone: own.get("Phone") ?? "",
    billType: own.get("Bill Type") === "Expense" ? "Expense" : "Bill",
    coiExpires: (own.get("COI Expires") ?? "").slice(0, 10),
    vendorType: own.get("Type") ?? "",
    addresses: ((a.locations?.nodes ?? []) as any[])
      .map((l) => String(l?.formattedAddress ?? l?.address ?? "").trim())
      .filter(Boolean),
    contacts: ((a.contacts?.nodes ?? []) as any[]).map((c) => {
      const cf = new Map<string, string>(
        ((c?.customFieldValues?.nodes ?? []) as any[]).map(cfPair),
      );
      return {
        name: String(c?.name ?? ""),
        title: String(c?.title ?? ""),
        email: cf.get("Email") ?? "",
        phone: cf.get("Phone") ?? "",
      };
    }),
  };
}

export interface ContactMatch {
  /** The person, or "" for an account match with no person named. */
  name: string;
  title: string;
  account: string;
  /** "customer" or "vendor". */
  accountType: string;
  email: string;
  phone: string;
  addresses: string[];
  /** Other people on a matched account, by name only. */
  people?: string[];
}

/**
 * Customers, vendors and their people whose name holds `text` — AscentBot's
 * "what is Amanda's number?". One request: org `contacts` and org `accounts`,
 * each a `like` match (case-insensitive, probed live 2026-10-28). Email / Phone
 * are custom fields (see getVendorDetail): a customer's sit on the contact,
 * a vendor's often on the account, so both are read. Nested
 * `customFieldValues` on a paged connection is the 413 shape — held to 10 rows.
 */
export async function findContacts(cfg: PaveConfig, text: string): Promise<ContactMatch[]> {
  const like = `%${text.trim()}%`;
  const CF = { $: { size: 20 }, nodes: { value: {}, customField: { name: {} } } };
  const LOC = { $: { size: 5 }, nodes: { address: {}, formattedAddress: {} } };
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      contacts: {
        $: { where: { and: [["name", "like", like]] }, size: 10 },
        nodes: {
          name: {},
          title: {},
          customFieldValues: CF,
          account: { name: {}, type: {}, locations: LOC },
        },
      },
      accounts: {
        $: { where: { and: [["name", "like", like]] }, size: 10 },
        nodes: {
          name: {},
          type: {},
          customFieldValues: CF,
          locations: LOC,
          contacts: { $: { size: 10 }, nodes: { name: {} } },
        },
      },
    },
  });
  const cf = (n: any) => new Map<string, string>(((n?.customFieldValues?.nodes ?? []) as any[]).map(cfPair));
  const addrs = (a: any) =>
    ((a?.locations?.nodes ?? []) as any[])
      .map((l) => String(l?.formattedAddress ?? l?.address ?? "").trim())
      .filter(Boolean);
  const people = ((r?.organization?.contacts?.nodes ?? []) as any[]).map((c): ContactMatch => {
    const f = cf(c);
    return {
      name: String(c?.name ?? ""),
      title: String(c?.title ?? ""),
      account: String(c?.account?.name ?? ""),
      accountType: String(c?.account?.type ?? ""),
      email: f.get("Email") ?? "",
      phone: f.get("Phone") ?? "",
      addresses: addrs(c?.account),
    };
  });
  const accounts = ((r?.organization?.accounts?.nodes ?? []) as any[]).map((a): ContactMatch => {
    const f = cf(a);
    return {
      name: "",
      title: "",
      account: String(a?.name ?? ""),
      accountType: String(a?.type ?? ""),
      email: f.get("Email") ?? "",
      phone: f.get("Phone") ?? "",
      addresses: addrs(a),
      people: ((a?.contacts?.nodes ?? []) as any[]).map((c) => String(c?.name ?? "")).filter(Boolean),
    };
  });
  return [...people, ...accounts];
}

/**
 * The vendors who billed a job, each with the cost code it billed most to (its
 * trade, as a homeowner would read it) — the contact picker on /house-manual.
 * Same approved+pending bill lines as the job's cost totals; `account` and
 * `costCode` are plain references, so nothing heavy rides the paged walk.
 */
export async function getJobVendors(cfg: PaveConfig, jobId: string): Promise<JobVendor[]> {
  const nodes = await pageAll<any>(cfg, {
    label: "job.costItems (job vendors)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: { where: CTC_ACTUAL_WHERE, ...args },
          nextPage: {},
          nodes: { cost: {}, costCode: { name: {} }, document: { account: { id: {}, name: {} } } },
        },
      },
    }),
    pick: (r) => r?.job?.costItems,
  });
  const byVendor = new Map<string, { name: string; cost: number; byCode: Map<string, number> }>();
  for (const n of nodes) {
    const acct = n?.document?.account;
    if (!acct?.id) continue;
    const v = byVendor.get(acct.id) ?? { name: String(acct.name ?? ""), cost: 0, byCode: new Map() };
    const cost = typeof n.cost === "number" ? n.cost : 0;
    const code = String(n?.costCode?.name ?? "").replace(/^Uncategorized\s*/i, "");
    v.cost += cost;
    v.byCode.set(code, (v.byCode.get(code) ?? 0) + cost);
    byVendor.set(acct.id, v);
  }
  return [...byVendor]
    .map(([id, v]) => ({
      id,
      name: v.name,
      trade: [...v.byCode].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      cost: v.cost,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A job's budget lines flagged as JobTread Specifications, with their descriptions. */
export async function getJobSpecifications(cfg: PaveConfig, jobId: string): Promise<JtSpec[]> {
  const nodes = await pageAll<any>(cfg, {
    label: "job.costItems (specifications)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: { where: { "=": [{ field: ["document", "id"] }, { value: null }] }, ...args },
          nextPage: {},
          nodes: { name: {}, description: {}, isSpecification: {}, costGroup: { name: {} } },
        },
      },
    }),
    pick: (r) => r?.job?.costItems,
  });
  return nodes
    .filter((n) => n?.isSpecification)
    .map((n) => ({ group: String(n?.costGroup?.name ?? ""), name: String(n?.name ?? ""), description: String(n?.description ?? "") }));
}

/** A recent vendor bill, org-wide, with enough to answer "was this paid?". */
export interface RecentVendorBill {
  id: string;
  number: number | null;
  vendorId: string;
  vendorName: string;
  issueDate: string | null;
  status: string;
  cost: number;
  amountPaid: number;
  balance: number;
  jobId: string | null;
  jobName: string;
}

/**
 * Every vendor bill issued on or after `sinceIso`, across the org.
 *
 * ONE query rather than a call per vendor: the mail check looks at a few dozen
 * vendors at a time, and forty round trips to answer "is there a bill near this
 * email" would dominate the page load. `organization.documents` takes the same
 * `["type","vendorBill"]` filter used elsewhere here, and `account` and `job`
 * are plain references, so nothing heavy is nested inside the paged connection.
 *
 * Confirmed live 2026-09-23: `amountPaid` and `balance` come back per document,
 * and a DRAFT reads 0/0 — see `paymentState`, which is why status is carried.
 */
export async function getRecentVendorBills(
  cfg: PaveConfig,
  sinceIso: string,
): Promise<RecentVendorBill[]> {
  const nodes = await pageAll<any>(cfg, {
    label: "organization.documents (recent vendor bills)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        documents: {
          $: {
            where: {
              and: [
                { "=": [{ field: "type" }, { value: "vendorBill" }] },
                { ">=": [{ field: "issueDate" }, { value: sinceIso }] },
              ],
            },
            sortBy: [{ field: "issueDate", order: "desc" }],
            ...args,
          },
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            issueDate: {},
            status: {},
            cost: {},
            amountPaid: {},
            balance: {},
            account: { id: {}, name: {} },
            job: { id: {}, name: {} },
          },
        },
      },
    }),
    pick: (r) => r?.organization?.documents,
  });
  return nodes.map((n) => ({
    id: String(n?.id ?? ""),
    number: typeof n?.number === "number" ? n.number : null,
    vendorId: String(n?.account?.id ?? ""),
    vendorName: String(n?.account?.name ?? ""),
    issueDate: n?.issueDate ? String(n.issueDate).slice(0, 10) : null,
    status: String(n?.status ?? ""),
    cost: Number(n?.cost) || 0,
    amountPaid: Number(n?.amountPaid) || 0,
    balance: Number(n?.balance) || 0,
    jobId: n?.job?.id ? String(n.job.id) : null,
    jobName: String(n?.job?.name ?? ""),
  }));
}

export interface VendorBillMatch extends VendorBillRow {
  vendorName: string;
}

/**
 * Org-wide bill-number lookup. Bill numbers are NOT unique across vendors —
 * confirmed live: #98 matches three different vendors/jobs — so this always
 * returns every match rather than assuming one, using `organization.documents`
 * (the org-wide connection; `document.account { name }` resolves directly so
 * no second query is needed to disambiguate the results).
 */
export async function getBillsByNumber(
  cfg: PaveConfig,
  number: number,
): Promise<VendorBillMatch[]> {
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      documents: {
        $: {
          where: {
            and: [
              ["type", "vendorBill"],
              ["number", number],
            ],
          },
          size: 50,
        },
        nodes: {
          id: {},
          number: {},
          cost: {},
          status: {},
          issueDate: {},
          job: { id: {}, name: {} },
          account: { name: {} },
        },
      },
    },
  });
  const nodes = (r?.organization?.documents?.nodes ?? []) as any[];
  return nodes.map((b) => ({
    id: b.id,
    number: typeof b?.number === "number" ? b.number : null,
    jobId: b?.job?.id ?? null,
    jobName: b?.job?.name ?? "—",
    cost: typeof b?.cost === "number" ? b.cost : 0,
    status: b?.status ?? "",
    issueDate: b?.issueDate ?? null,
    vendorName: b?.account?.name ?? "Unknown vendor",
  }));
}

/**
 * WRITE — update a bill line: its coding (jobCostItemId), quantity, and/or
 * unitCost. Confirmed production mutation (ascent-appscript JobTread.js):
 * updateCostItem accepts all three. Callers must gate this behind the
 * writes-enabled flag; a customer bill is shared with the AppSheet flow, so
 * nothing here runs until that coordination is settled.
 */
/** A time-entry pay type available to one member (its `name` is the `type` field). */
export interface PayType {
  name: string;
  hourlyRate?: number;
}

export interface UserRef {
  id: string;
  name: string; // JobTread's DISPLAY name — what its importer matches on
  isInternal: boolean;
  types?: PayType[]; // undefined when the grant can't read per-member types
  membershipId?: string; // the org membership id — REQUIRED to write rates (updateMembership)
}

export async function fetchMembers(cfg: PaveConfig, withTypes: boolean): Promise<UserRef[]> {
  const out: UserRef[] = [];
  const nodes: Record<string, unknown> = {
    id: {},
    isInternal: {},
    user: { id: {}, name: {} },
  };
  // Array of { name, hourlyRate } — the sub-fields must be selected explicitly;
  // an empty {} returns the objects with no fields (name comes back undefined).
  if (withTypes) nodes.timeEntryTypes = { name: {}, hourlyRate: {} };
  await pageEach<any>(
    cfg,
    {
      label: "organization.memberships",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          memberships: { $: args, nextPage: {}, nodes },
        },
      }),
      pick: (r) => r?.organization?.memberships,
    },
    (rows) => {
      for (const n of rows) {
        const u = n?.user;
        if (!u?.id) continue;
        out.push({
          id: u.id,
          name: u.name ?? "",
          isInternal: !!n.isInternal,
          types: withTypes ? ((n.timeEntryTypes ?? []) as PayType[]) : undefined,
          membershipId: n.id ?? undefined,
        });
      }
    },
  );
  // Internal staff first (the people who log labor), then alphabetical.
  return out.sort(
    (a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name),
  );
}

/**
 * Org members (JobTread users), for the labor importer's worker mapping.
 *
 * `user.name` is the display name JobTread matches on. It's usually just a first
 * name ("Cedar", "Tommy", "Casey") but NOT always — "Ty O'Steen" is the full
 * name — so it must be read from JT, never synthesised from the QB first name.
 * `user` exposes no email, so name/id are the only handles.
 *
 * `timeEntryTypes` is each member's OWN set of pay types (the time entry `type`
 * field). Reading it requires the `createTimeEntryForMembership` action on the
 * grant; if the grant lacks it the whole query 403s, so we retry without it and
 * callers fall back to the org-wide type list.
 */
export function getOrgUsers(cfg: PaveConfig): Promise<UserRef[]> {
  return cachedRef(`users:${cfg.orgId}`, 30 * 60_000, () => _getOrgUsersUncached(cfg));
}
export async function _getOrgUsersUncached(cfg: PaveConfig): Promise<UserRef[]> {
  try {
    return await fetchMembers(cfg, true);
  } catch {
    return await fetchMembers(cfg, false);
  }
}

/** Every pay-type name configured on the org — the fallback list. */
export function getOrgTimeEntryTypeNames(cfg: PaveConfig): Promise<string[]> {
  return cachedRef(`typeNames:${cfg.orgId}`, 60 * 60_000, () =>
    _getOrgTimeEntryTypeNamesUncached(cfg),
  );
}
export async function _getOrgTimeEntryTypeNamesUncached(cfg: PaveConfig): Promise<string[]> {
  const r = await pave(cfg, {
    organization: { $: { id: cfg.orgId }, id: {}, timeEntryTypeNames: {} },
  });
  return (r?.organization?.timeEntryTypeNames ?? []) as string[];
}

/** Read ONE membership's current pay types fresh (bypasses the 30-min getOrgUsers
 *  cache) — the read half of a read-modify-write rate update. */
export async function getMembershipRates(
  cfg: PaveConfig,
  membershipId: string,
): Promise<PayType[]> {
  const r = await pave(cfg, {
    membership: { $: { id: membershipId }, id: {}, timeEntryTypes: { name: {}, hourlyRate: {} } },
  });
  return (r?.membership?.timeEntryTypes ?? []) as PayType[];
}

/**
 * Overwrite a membership's pay types (its labor rates). CONFIRMED live 2026-07-29
 * via a reversible probe on the owner's own membership:
 *  - `timeEntryTypes` is a WHOLE-ARRAY REPLACE — any type omitted is DELETED, so
 *    callers MUST pass the COMPLETE desired set (read-modify-write), never a delta.
 *  - a timeEntryTypes-only updateMembership leaves role/isInternal untouched.
 *  - keyed by MEMBERSHIP id (not user id); the grant needs the `updateMembership`
 *    action (the org's "Sunset Invoce Automation" grant is unrestricted).
 * JobTread caps a membership at 20 pay types. Callers gate behind writesEnabled()
 * and clearJtRefCache() afterward so the roster re-reads. Returns the new set.
 */
export async function updateMembershipRates(
  cfg: PaveConfig,
  membershipId: string,
  types: PayType[],
): Promise<PayType[]> {
  const clean = types
    .map((t) => ({ name: String(t.name ?? "").trim(), hourlyRate: Number(t.hourlyRate ?? 0) }))
    .filter((t) => t.name && Number.isFinite(t.hourlyRate));
  if (clean.length > 20) {
    throw new Error(`A member can have at most 20 pay types (got ${clean.length}).`);
  }
  const r = await pave(cfg, {
    updateMembership: {
      $: { id: membershipId, timeEntryTypes: clean },
      membership: {
        $: { id: membershipId },
        id: {},
        timeEntryTypes: { name: {}, hourlyRate: {} },
      },
    },
  });
  return (r?.updateMembership?.membership?.timeEntryTypes ?? []) as PayType[];
}

export async function updateLine(
  cfg: PaveConfig,
  costItemId: string,
  fields: {
    name?: string;
    jobCostItemId?: string;
    quantity?: number;
    unitCost?: number;
    description?: string;
  },
): Promise<{ id: string }> {
  const $: Record<string, unknown> = { id: costItemId };
  if (fields.name !== undefined) $.name = fields.name.substring(0, 250);
  if (fields.jobCostItemId !== undefined) $.jobCostItemId = fields.jobCostItemId;
  if (fields.quantity !== undefined) $.quantity = fields.quantity;
  if (fields.unitCost !== undefined) $.unitCost = fields.unitCost;
  if (fields.description !== undefined) $.description = fields.description;
  const r = await pave(cfg, {
    updateCostItem: { $, costItem: { $: { id: costItemId }, id: {} } },
  });
  return { id: r?.updateCostItem?.costItem?.id ?? costItemId };
}

/**
 * THE LINE-LEVEL TAX FLAG, and why every bill line Ascent writes is TAXABLE.
 *
 * `isTaxable` does nothing on a vendor bill — a bill's own `taxRate` is pinned
 * to 0 and its tax lives on an 88 80 00 line (src/lib/salesTax.ts). It was
 * therefore written as `false` for years on the reasoning that it moved no
 * money.
 *
 * IT MOVES MONEY ON THE NEXT DOCUMENT. Create Invoice COPIES the flag onto the
 * client invoice it builds, and a client invoice taxes only the lines that
 * carry it. So a `false` here quietly shrinks that invoice's tax base and
 * under-bills the client sales tax Ascent still owes the state — and nothing
 * downstream notices, because the invoice foots against the reduced tax
 * JobTread then states.
 *
 * Ferron / Otis Perkins Addition, August 2026: one line of a 13-line Element
 * Smart Roofing bill, $4,156.25, added after the bill was created. Invoice
 * #382 came to $169,120.20 where the tracking sheet said $169,530.51.
 *
 * So the default is TRUE, matching /api/add-bill and the Apps Script
 * ingestion, and a bill's lines no longer depend on whether they arrived with
 * the bill or were added to it afterwards. The ONE line that stays false is
 * the 88 80 00 sales-tax line itself, which must never be taxed again.
 *
 * This is not what suppresses the tax carve — that is the document's own
 * `taxRate: 0`, forced before each write below.
 */
export const BILL_LINE_IS_TAXABLE = true;

/**
 * Add a new line (cost item) to an existing bill. Uses the confirmed
 * `createCostItem` mutation with `documentId` (same fields as createVendorBill's
 * lineItems — proven in the production Apps Script push). jobCostItemId is
 * optional: omit it and the line lands uncoded. Tax stays at the document level
 * (nonRecoverableTax); the line's own flag is TAXABLE, because Create Invoice
 * copies it onto the client invoice — see BILL_LINE_IS_TAXABLE.
 *
 * TAX-CARVE GUARD (confirmed live 2026-07-18): if the target bill carries a
 * non-zero document `taxRate` (bills NOT created by the Assistant can — e.g. an
 * old empty JobTread bill), JobTread treats the entered amount as tax-INCLUSIVE
 * and divides it (e.g. 79.99 → cost 73.23 + tax 6.76), so the amount is wrong.
 * We defend the way createVendorBill does — force the document to `taxRate: 0`
 * first (tax on a bill lives in nonRecoverableTax, never a per-line rate) — and,
 * as a backstop, re-assert the exact amount with the confirmed updateCostItem
 * once the rate is 0 so any residual carve is corrected. Both extra writes are
 * best-effort: never fail the add over them.
 */
export async function createLine(
  cfg: PaveConfig,
  docId: string,
  fields: {
    name: string;
    jobCostItemId?: string;
    quantity?: number;
    unitCost?: number;
    description?: string;
    /** Raw CSI → the "Cost Codes" custom field, the same one createVendorBill
     *  writes. Omit and no custom field is sent, which is what every caller
     *  before the bill-replace path did. */
    costCode?: string;
  },
): Promise<{ id: string }> {
  const quantity = fields.quantity ?? 1;
  const unitCost = fields.unitCost ?? 0;

  // 1) Force taxRate 0 so JT takes the amount at face value (not tax-inclusive).
  try {
    await pave(cfg, {
      updateDocument: { $: { id: docId, taxRate: 0 }, document: { $: { id: docId }, id: {} } },
    });
  } catch {
    /* best-effort — the re-assert below corrects any carve that slips through */
  }

  const $: Record<string, unknown> = {
    documentId: docId,
    name: (fields.name || "Line item").substring(0, 250),
    quantity,
    unitCost,
    isTaxable: BILL_LINE_IS_TAXABLE,
  };
  if (fields.jobCostItemId) $.jobCostItemId = fields.jobCostItemId;
  if (fields.description !== undefined) $.description = fields.description;
  if (fields.costCode) {
    $.customFieldValues = [{ customFieldId: CF_COST_CODES, value: fields.costCode }];
  }
  const r = await pave(cfg, {
    createCostItem: { $, createdCostItem: { id: {} } },
  });
  const id = r?.createCostItem?.createdCostItem?.id;
  if (!id) throw new Error("createCostItem returned no cost item id.");

  // 2) Backstop: with the document now at taxRate 0, re-assert the amount so a
  //    tax-inclusive carve from the insert lands back at the entered value.
  try {
    await pave(cfg, {
      updateCostItem: {
        $: { id, unitCost, quantity, isTaxable: BILL_LINE_IS_TAXABLE },
        costItem: { $: { id }, id: {} },
      },
    });
  } catch {
    /* the line exists; don't fail the add over the re-assert */
  }

  return { id };
}

/**
 * One bill LINE, as the financial journal records it before a destructive edit.
 *
 * `deleteCostItem` removes a line outright and JobTread keeps nothing that says
 * what it held. This read is what turns a delete from a disappearance into a
 * record: the amount, the code it was coded to, and the bill it was on, captured
 * immediately before the line stops existing.
 *
 * Returns `null` on ANY failure, for the same reason as
 * `getBillJournalSnapshot` — a missing before-value is recorded honestly and
 * must never block the write.
 */
export async function getLineJournalSnapshot(
  cfg: PaveConfig,
  costItemId: string,
): Promise<{
  name: string;
  description: string;
  cost: number | null;
  quantity: number | null;
  unitCost: number | null;
  code: string;
  codeName: string;
  jobCostItemId: string;
  docId: string;
  jobId: string;
} | null> {
  try {
    const r: any = await pave(cfg, {
      costItem: {
        $: { id: costItemId },
        id: {},
        name: {},
        description: {},
        cost: {},
        quantity: {},
        unitCost: {},
        costCode: { number: {}, name: {} },
        jobCostItem: { id: {} },
        document: { id: {}, job: { id: {} } },
      },
    });
    const c = r?.costItem;
    if (!c) return null;
    return {
      name: c.name ?? "",
      description: c.description ?? "",
      cost: typeof c.cost === "number" ? c.cost : null,
      quantity: typeof c.quantity === "number" ? c.quantity : null,
      unitCost: typeof c.unitCost === "number" ? c.unitCost : null,
      code: c.costCode?.number ?? "",
      codeName: c.costCode?.name ?? "",
      jobCostItemId: c.jobCostItem?.id ?? "",
      docId: c.document?.id ?? "",
      jobId: c.document?.job?.id ?? "",
    };
  } catch {
    return null;
  }
}

/** WRITE — delete a bill line (cost item). Confirmed mutation `deleteCostItem`
 * (ascent-appscript JobTread.js), no response selection. Draft-only per callers. */
export async function deleteLine(cfg: PaveConfig, costItemId: string): Promise<void> {
  await pave(cfg, { deleteCostItem: { $: { id: costItemId } } });
}

/**
 * WRITE — combine several of a bill's lines that share a cost code into one.
 * Keeps `keepId`, sets its amount to the summed extended cost (qty 1 × the sum)
 * and its name to the concatenated line descriptions, re-points it to the shared
 * code, then deletes the rest. Draft-only (callers gate on status + writesEnabled).
 *
 * `extendedCost` is the sum of the combined lines' STORED (tax-inclusive) costs,
 * so the bill total is unchanged. Mirrors createLine's tax guard: force the
 * document to taxRate 0 first so JobTread takes the amount at face value (bill tax
 * lives in nonRecoverableTax, never a per-line rate), then re-assert to undo any
 * carve. All mutations use the confirmed updateCostItem/deleteCostItem shapes.
 */
export async function combineLines(
  cfg: PaveConfig,
  args: {
    docId: string;
    keepId: string;
    deleteIds: string[];
    name: string;
    extendedCost: number;
    jobCostItemId?: string;
    description?: string;
  },
): Promise<{ keptId: string; deleted: number }> {
  const { docId, keepId, deleteIds } = args;
  const name = (args.name || "Line item").substring(0, 250);
  const unitCost = Math.round(args.extendedCost * 100) / 100;

  // 1) taxRate 0 so JT doesn't treat the summed amount as tax-inclusive (carve it).
  try {
    await pave(cfg, {
      updateDocument: { $: { id: docId, taxRate: 0 }, document: { $: { id: docId }, id: {} } },
    });
  } catch {
    /* best-effort — the re-assert below corrects any residual carve */
  }

  // 2) Fold everything onto the kept line: qty 1 × summed cost, concatenated name.
  const $: Record<string, unknown> = {
    id: keepId,
    name,
    quantity: 1,
    unitCost,
    isTaxable: BILL_LINE_IS_TAXABLE,
  };
  if (args.jobCostItemId) $.jobCostItemId = args.jobCostItemId;
  if (args.description !== undefined) $.description = args.description;
  await pave(cfg, { updateCostItem: { $, costItem: { $: { id: keepId }, id: {} } } });

  // 3) Backstop: re-assert the amount now that taxRate is 0.
  try {
    await pave(cfg, {
      updateCostItem: {
        $: { id: keepId, unitCost, quantity: 1, isTaxable: BILL_LINE_IS_TAXABLE },
        costItem: { $: { id: keepId }, id: {} },
      },
    });
  } catch {
    /* the line exists; don't fail the combine over the re-assert */
  }

  // 4) Delete the folded-in lines.
  let deleted = 0;
  for (const id of deleteIds) {
    try {
      await pave(cfg, { deleteCostItem: { $: { id } } });
      deleted++;
    } catch {
      /* keep going; report how many actually deleted */
    }
  }
  return { keptId: keepId, deleted };
}
