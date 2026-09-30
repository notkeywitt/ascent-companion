/**
 * The registry of EDITABLE ON-SCREEN TEXT — every string the office can reword
 * from /admin/copy without a deploy.
 *
 * PURE module — no DB, Node, or React imports — so it is safe to import from
 * server components, client components, and the admin editor alike (same rule
 * as views.ts, which this deliberately resembles).
 *
 * THE MODEL (mirrors `role_access` → `page_copy` in db/schema.ts): the English
 * below is the SHIPPED DEFAULT and lives in the code. A row in `page_copy` only
 * ever OVERRIDES it. So:
 *   - an empty/unreachable DB renders the built-in wording — copy can never go
 *     blank because a query failed,
 *   - deleting a row is how you revert to the shipped text, and
 *   - a key that disappears from this registry is ignored, not rendered raw.
 *
 * To make a NEW piece of text editable:
 *   1. add an entry here (pick a `group` so it lands under the right heading in
 *      the editor, and write the current wording as `text`), then
 *   2. in the page, render `c("your.key")` instead of the literal, where
 *      `const c = useCopy()` (client) or `c = await getCopy()` (server).
 * Nothing else — the editor lists whatever is in this file automatically.
 */

/** A group heading in the /admin/copy editor. Order here = order on the page. */
export const COPY_GROUPS = [
  "Bottom bar",
  "Home — Financials",
  "Home — Office",
  "Home — Utilities",
  "Home — Admin",
  "Page headers",
  "Tracking Sheets — header",
  "Tracking Sheets — controls",
  "Tracking Sheets — help text",
  "Tracking Sheets — empty states",
  "Tracking Sheets — loading & fields",
] as const;

export type CopyGroup = (typeof COPY_GROUPS)[number];

export interface CopyEntry {
  /** The shipped English. Rendered whenever there is no override row. */
  text: string;
  /** Short human label for the editor's field ("Tracking Sheets — description"). */
  label: string;
  group: CopyGroup;
  /** True for text with a tight space budget (a 4-across button, a chip). */
  short?: boolean;
  /**
   * `{token}` names this string accepts, listed under the field in the editor.
   * Keep them in any reworded text — a dropped token loses the value it stood
   * for (the month, a count), though nothing breaks if one goes missing.
   */
  tokens?: string[];
}

/**
 * Every editable string, keyed by a stable id. The id is what lands in the DB,
 * so RENAME WITH CARE — a renamed key orphans its override (the text falls back
 * to the default below, which is safe, but the edit is lost).
 *
 * Naming: `<page>.<thing>.<field>` — e.g. `home.dest.recode.label`.
 */
export const COPY: Record<string, CopyEntry> = {
  // ── The bottom bar: the short word under each single-page slot ──────────
  // Same keys as the retired launcher buttons, so an office rewording carries
  // over. Keep them SHORT: five slots share a phone's width. A workspace slot
  // (Month Close, Incoming Bills …) shows the workspace's own name.
  "home.quick.mileage.label": { text: "Miles", label: "Miles — bar", group: "Bottom bar", short: true },
  "home.quick.employee-time.label": { text: "Time", label: "Time — bar", group: "Bottom bar", short: true },
  "home.quick.tools.label": { text: "Tools", label: "Tools — bar", group: "Bottom bar", short: true },
  "home.quick.requisitions.label": { text: "Requisitions", label: "Requisitions — bar", group: "Bottom bar", short: true },
  "home.quick.time-off.label": { text: "Time Off", label: "Time Off — bar", group: "Bottom bar", short: true },

  // ── Home launcher: Financials destinations ───────────────────────────────
  "home.dest.recode.label": { text: "Tracking Sheets", label: "Tracking Sheets — name", group: "Home — Financials" },
  "home.dest.recode.desc": {
    text: "Code a month's bills against live budget headroom",
    label: "Tracking Sheets — description",
    group: "Home — Financials",
  },
  "home.dest.labor-review.label": { text: "Labor Review", label: "Labor Review — name", group: "Home — Financials" },
  "home.dest.invoice-review.label": { text: "Invoice Review", label: "Invoice Review — name", group: "Home — Financials" },
  "home.dest.invoice-review.desc": {
    text: "Check a month's client invoices against the bills and the backup",
    label: "Invoice Review — description",
    group: "Home — Financials",
  },
  "home.dest.labor-review.desc": {
    text: "Code a month's logged time against the same headroom",
    label: "Labor Review — description",
    group: "Home — Financials",
  },
  "home.dest.tracking-sheet.label": { text: "Finalize", label: "Finalize — name", group: "Home — Financials" },
  "home.dest.tracking-sheet.desc": {
    text: "Push a job's month into its tracking sheet",
    label: "Finalize — description",
    group: "Home — Financials",
  },
  "home.dest.payments.label": { text: "Sunset Statements", label: "Sunset Statements — name", group: "Home — Financials" },
  "home.dest.payments.desc": {
    text: "Pay a statement & reconcile its invoices",
    label: "Sunset Statements — description",
    group: "Home — Financials",
  },
  "home.dest.clients.label": {
    text: "Directory",
    label: "Directory — name",
    group: "Home — Financials",
  },
  "home.dest.clients.desc": {
    text: "Every customer and job in JobTread — edit the record",
    label: "Directory — description",
    group: "Home — Financials",
  },
  "home.dest.vendors.label": { text: "Vendors", label: "Vendors — name", group: "Home — Financials" },
  "home.dest.vendors.desc": {
    text: "Search a vendor's bills — job, date, amount",
    label: "Vendors — description",
    group: "Home — Financials",
  },
  "home.dest.expenditure-history.label": {
    text: "Bill Archive",
    label: "Bill Archive — name",
    group: "Home — Financials",
  },
  "home.dest.expenditure-history.desc": {
    text: "The sheet's archive, including the years before JobTread",
    label: "Bill Archive — description",
    group: "Home — Financials",
  },

  // ── Home launcher: Office destinations (the "hr" area) ───────────────────
  "home.dest.office.label": { text: "Office Dashboard", label: "Office Dashboard — name", group: "Home — Office" },
  "home.dest.office.desc": {
    text: "The Office job's to-dos and files, and every office page",
    label: "Office Dashboard — description",
    group: "Home — Office",
  },
  "home.dest.leads.label": { text: "Leads", label: "Leads — name", group: "Home — Office" },
  "home.dest.leads.desc": {
    text: "New leads, who's overdue, who's gone quiet",
    label: "Leads — description",
    group: "Home — Office",
  },
  "home.dest.employees.label": { text: "Employees", label: "Employees — name", group: "Home — Office" },
  "home.dest.employees.desc": {
    text: "The Project Database roster",
    label: "Employees — description",
    group: "Home — Office",
  },
  "home.dest.labor-import.label": { text: "Labor Import", label: "Labor Import — name", group: "Home — Office" },
  "home.dest.labor-import.desc": {
    text: "QuickBooks labor → JobTread CSV",
    label: "Labor Import — description",
    group: "Home — Office",
  },
  "home.dest.labor-rates.label": { text: "Pay Rates", label: "Pay Rates — name", group: "Home — Office" },
  "home.dest.labor-rates.desc": {
    text: "Per-project pay rates & who has them",
    label: "Pay Rates — description",
    group: "Home — Office",
  },
  "home.dest.time-off.label": { text: "Time Off", label: "Time Off — name", group: "Home — Office" },
  "home.dest.time-off.desc": {
    text: "Requests, balances & accrual policy",
    label: "Time Off — description",
    group: "Home — Office",
  },
  "home.dest.safety-meeting.label": { text: "Safety Meeting", label: "Safety Meeting — name", group: "Home — Office" },
  "home.dest.safety-meeting.desc": {
    text: "Pass the iPad and collect sign-ins",
    label: "Safety Meeting — description",
    group: "Home — Office",
  },

  // ── Home launcher: Utilities destinations ────────────────────────────────
  "home.dest.unbilled.label": { text: "Unbilled", label: "Unbilled — name", group: "Home — Utilities" },
  "home.dest.unbilled.desc": {
    text: "Uninvoiced expenses by cost code",
    label: "Unbilled — description",
    group: "Home — Utilities",
  },
  "home.dest.email.label": { text: "Email Invoices", label: "Email Invoices — name", group: "Home — Utilities" },
  "home.dest.email.desc": {
    text: "Log invoices from the office inbox",
    label: "Email Invoices — description",
    group: "Home — Utilities",
  },
  "home.dest.vendor-mail.label": { text: "Mail Check", label: "Mail Check — name", group: "Home — Utilities" },
  "home.dest.vendor-mail.desc": {
    text: "Every vendor email, and whether it was captured",
    label: "Mail Check — description",
    group: "Home — Utilities",
  },
  "home.dest.needs-project.label": { text: "Not in JobTread", label: "Not in JobTread — name", group: "Home — Utilities" },
  "home.dest.needs-project.desc": {
    text: "Ingested bills with no job yet",
    label: "Not in JobTread — description",
    group: "Home — Utilities",
  },
  "home.dest.amazon-import.label": { text: "Amazon Import", label: "Amazon Import — name", group: "Home — Utilities" },
  "home.dest.amazon-import.desc": {
    text: "Monthly Amazon report → batch of bills",
    label: "Amazon Import — description",
    group: "Home — Utilities",
  },
  "home.dest.lswdd.label": { text: "LSWDD Statement", label: "LSWDD Statement — name", group: "Home — Utilities" },
  "home.dest.lswdd.desc": {
    text: "Split the dump's monthly statement across jobs",
    label: "LSWDD Statement — description",
    group: "Home — Utilities",
  },
  "home.dest.chat.label": { text: "Assistant", label: "Assistant — name", group: "Home — Utilities" },
  "home.dest.chat.desc": {
    text: "Ask about a job's bills or budget",
    label: "Assistant — description",
    group: "Home — Utilities",
  },
  "home.dest.rfis.label": { text: "RFIs", label: "RFIs — name", group: "Home — Utilities" },
  "home.dest.rfis.desc": {
    text: "View and create a job's RFIs",
    label: "RFIs — description",
    group: "Home — Utilities",
  },
  "home.dest.time-sync.label": { text: "Time Sync", label: "Time Sync — name", group: "Home — Utilities" },
  "home.dest.time-sync.desc": {
    text: "Time records JobTread doesn't have right",
    label: "Time Sync — description",
    group: "Home — Utilities",
  },
  "home.dest.notices.label": { text: "Notices", label: "Notices — name", group: "Home — Utilities" },
  "home.dest.notices.desc": {
    text: "Post a banner to the team — now or scheduled",
    label: "Notices — description",
    group: "Home — Utilities",
  },
  "home.dest.requests.label": { text: "App Feedback", label: "App Feedback — name", group: "Home — Utilities" },
  "home.dest.requests.desc": {
    text: "Ask for fixes and new features",
    label: "App Feedback — description",
    group: "Home — Utilities",
  },
  "home.dest.actions.label": { text: "Actions", label: "Actions — name", group: "Home — Utilities" },
  "home.dest.actions.desc": {
    text: "Run a script job on demand",
    label: "Actions — description",
    group: "Home — Utilities",
  },
  "home.dest.help.label": { text: "Help", label: "Help — name", group: "Home — Utilities" },
  "home.dest.help.desc": {
    text: "How to do the things this app does, step by step",
    label: "Help — description",
    group: "Home — Utilities",
  },

  // ── Home launcher: Admin destinations ────────────────────────────────────
  "home.dest.admin.label": { text: "Access", label: "Access — name", group: "Home — Admin" },
  "home.dest.admin.desc": { text: "Who can sign in, and what each role can open", label: "Access — description", group: "Home — Admin" },
  "home.dest.logs.label": { text: "System Logs", label: "System Logs — name", group: "Home — Admin" },
  "home.dest.logs.desc": {
    text: "The automation audit trail",
    label: "System Logs — description",
    group: "Home — Admin",
  },
  "home.dest.historical-cost.label": {
    text: "Historical Cost Import",
    label: "Historical Cost Import — name",
    group: "Home — Admin",
  },
  "home.dest.historical-cost.desc": {
    text: "Backfill a job's pre-JobTread costs as one draft bill",
    label: "Historical Cost Import — description",
    group: "Home — Admin",
  },
  "home.dest.page-copy.label": { text: "Page Text", label: "Page Text — name", group: "Home — Admin" },
  "home.dest.page-copy.desc": {
    text: "Reword the app's on-screen text",
    label: "Page Text — description",
    group: "Home — Admin",
  },

  // ── Page headers ─────────────────────────────────────────────────────────
  "page.jobs.title": { text: "Job Cost", label: "Job Cost — page title", group: "Page headers" },
  "page.chat.title": { text: "Assistant", label: "Assistant — page title", group: "Page headers" },
  "page.chat.placeholder": {
    text: "Ask about a job, bill, budget…",
    label: "Assistant — input placeholder",
    group: "Page headers",
  },
  "page.recode.title": { text: "Tracking Sheets", label: "Tracking Sheets — page title", group: "Page headers" },

  // ── /trackingsheet — page header ────────────────────────────────────────────────
  "recode.header.description": {
    text: "Move expenditure between cost codes against live budget headroom.",
    label: "Page subtitle",
    group: "Tracking Sheets — header",
  },
  "recode.header.descMonth": {
    text: "Every client invoice to stage this month — one card per job. Tap a job to open its workbench — the bills, cost-code breakdown, and time behind its total, and the button to create the invoice in JobTread.",
    label: "Page subtitle — “This month” tab",
    group: "Tracking Sheets — header",
  },
  "recode.statement.toBeInvoiced": {
    text: "To be invoiced",
    label: "Headline figure caption",
    group: "Tracking Sheets — header",
    short: true,
  },

  // ── /trackingsheet — toggles and controls ───────────────────────────────────────
  "recode.toggle.includeDrafts": {
    text: "Include drafts",
    label: "Include drafts — toggle",
    group: "Tracking Sheets — controls",
    short: true,
  },
  "recode.toggle.groupByCsi": {
    text: "Group by CSI code",
    label: "Group by CSI code — toggle",
    group: "Tracking Sheets — controls",
    short: true,
  },

  // ── /trackingsheet — the explanatory tooltips ───────────────────────────────────
  "recode.help.uninvoicedOnly": {
    text: "Off shows bills already on a customer invoice too, read-only — for reviewing a past, fully-invoiced month.",
    label: "Uninvoiced only — tooltip",
    group: "Tracking Sheets — help text",
  },
  "recode.help.includeDrafts": {
    text: "Shows draft bills below so you can code them. Drafts are never invoiceable until approved in JobTread, so this doesn't change the To be invoiced total.",
    label: "Include drafts — tooltip",
    group: "Tracking Sheets — help text",
  },
  "recode.help.approvedTime": {
    text: "Off counts only isApproved time entries toward labor and headroom — a more conservative number when a lot of logged time hasn't been approved yet.",
    label: "Approved time — tooltip",
    group: "Tracking Sheets — help text",
  },

  // ── /trackingsheet — empty states ───────────────────────────────────────────────
  "recode.empty.noJob": {
    text: "No job selected. Pick one above, or",
    label: "No job selected (before the link)",
    group: "Tracking Sheets — empty states",
  },
  "recode.empty.noJobLink": {
    text: "see every job this month",
    label: "No job selected — link text",
    group: "Tracking Sheets — empty states",
  },
  "recode.empty.noCodedLines": {
    text: "No coded lines in this month.",
    label: "No coded lines",
    group: "Tracking Sheets — empty states",
  },
  "recode.empty.noBills": {
    text: "No uninvoiced bills dated in this month.",
    label: "No uninvoiced bills",
    group: "Tracking Sheets — empty states",
  },
  "recode.empty.selectBill": {
    text: "Select a bill to edit its coding.",
    label: "No bill selected",
    group: "Tracking Sheets — empty states",
  },
  "recode.empty.nothingToStage": {
    text: "No client invoices to stage for {month} — every finalized bill is already invoiced.",
    label: "Nothing to stage (all-jobs view)",
    group: "Tracking Sheets — empty states",
    tokens: ["month"],
  },

  // ── /trackingsheet — loading labels and field placeholders ──────────────────────
  "recode.loading.billsAndBudget": {
    text: "Loading bills and budget…",
    label: "Loading — bills and budget",
    group: "Tracking Sheets — loading & fields",
  },
  "recode.loading.summary": {
    text: "Loading the billing summary…",
    label: "Loading — billing summary",
    group: "Tracking Sheets — loading & fields",
  },
  "recode.loading.billsAndTime": {
    text: "Loading bills and time entries…",
    label: "Loading — bills and time entries",
    group: "Tracking Sheets — loading & fields",
  },
  "recode.placeholder.filterCodes": {
    text: "Filter cost codes…",
    label: "Cost-code filter — placeholder",
    group: "Tracking Sheets — loading & fields",
    short: true,
  },
  "recode.placeholder.chooseJob": {
    text: "Choose a job…",
    label: "Job picker — placeholder",
    group: "Tracking Sheets — loading & fields",
    short: true,
  },
  "recode.placeholder.lineDescription": {
    text: "Line description",
    label: "New line description — placeholder",
    group: "Tracking Sheets — loading & fields",
    short: true,
  },
};

export type CopyKey = keyof typeof COPY;

/** Every registry id, in declaration order. */
export const ALL_COPY_KEYS: string[] = Object.keys(COPY);

/** The shipped default for a key ("" for an unknown key, never the raw id). */
export function defaultCopy(key: string): string {
  return COPY[key]?.text ?? "";
}

/**
 * Substitute `{name}` tokens. Unknown tokens are LEFT AS WRITTEN rather than
 * blanked, so an edit that misspells `{month}` shows the mistake plainly
 * instead of silently dropping a word out of the sentence.
 */
export function fillTokens(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * The resolver every surface goes through: an override wins, otherwise the
 * shipped default. A blank/whitespace-only override is treated as ABSENT — the
 * editor's "clear the box to revert" gesture — so copy can't be edited into
 * an empty label by accident.
 *
 * `vars` fills `{token}` placeholders (see `tokens` on the entry, which is what
 * the editor lists under the field so the person editing knows which ones the
 * sentence accepts).
 */
export function resolveCopy(
  overrides: Record<string, string>,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const override = overrides[key];
  const text =
    typeof override === "string" && override.trim() !== "" ? override : defaultCopy(key);
  return fillTokens(text, vars);
}

/** Drop unknown keys — a stale row from a renamed key never reaches a page. */
export function pruneOverrides(rows: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rows)) {
    if (k in COPY) out[k] = v;
  }
  return out;
}

/** The registry grouped for the editor UI, in COPY_GROUPS order. */
export function copyByGroup(): { group: CopyGroup; keys: string[] }[] {
  return COPY_GROUPS.map((group) => ({
    group,
    keys: ALL_COPY_KEYS.filter((k) => COPY[k].group === group),
  })).filter((g) => g.keys.length > 0);
}
