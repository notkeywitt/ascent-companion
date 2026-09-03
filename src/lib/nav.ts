/**
 * The launcher's destination list — the ONE place every gateable view is named.
 *
 * Pure data (no React, no DB), so both surfaces that need it can import it: the
 * home launcher (src/app/page.tsx), which renders these as hairline-divided area
 * lists, and the header's global search (src/components/GlobalSearch.tsx), which
 * matches against them. It used to live inside page.tsx, which meant the search
 * bar could only exist on the home page; lifting it here is what lets search move
 * into the app chrome and work from anywhere.
 *
 * A new view must appear in AREAS here, or it becomes dead — nothing else links
 * to most pages. Entries the signed-in user can't reach are filtered out by the
 * caller (see `access.can(d.view)`), and every user-visible string is resolved
 * through the copy registry so the office can reword it (src/lib/copy.ts).
 */

// `view` is the gate id from lib/views — entries the signed-in user can't see
// are filtered out by whoever renders the list.
export type Dest = { label: string; href: string; desc: string; view: string };
// `id` is the STABLE handle — React keys, expand state, and the copy registry
// key all hang off it, so the editable `title` can be reworded from
// Admin → Page Text without resetting anyone's expanded sections.
// `preview` optionally overrides PREVIEW_ROWS for one area (My Work shows all of
// its short list rather than hiding the daily tools behind "show more").
export type Area = { id: string; title: string; blurb: string; dests: Dest[]; preview?: number };

// How many rows an area shows before "show the rest" — enough that the short
// areas are complete at a glance, few enough that Utilities' nine don't bury
// everything under them.
export const PREVIEW_ROWS = 3;

export const AREAS: Area[] = [
  {
    id: "mywork",
    title: "My Work",
    blurb: "The everyday — your time, miles, tools, and requests.",
    // The five destinations every employee gets (FIELD_VIEWS in lib/views).
    // Shown in full — see `preview` — because these are the daily-use pages and
    // burying two of them behind "show more" would defeat the point.
    preview: 5,
    dests: [
      { label: "Employee Time", href: "/employee-time", desc: "Log and review your hours", view: "employee-time" },
      { label: "Mileage", href: "/mileage-tracker", desc: "Track your mileage", view: "mileage" },
      { label: "Tools", href: "/tools", desc: "The tool tracker", view: "tools" },
      { label: "Requisitions", href: "/requisitions", desc: "Request materials & supplies", view: "requisitions" },
      { label: "Time Off", href: "/time-off", desc: "Request time off & see your balance", view: "time-off" },
    ],
  },
  {
    id: "financials",
    title: "Financials",
    blurb: "Coding, invoicing, and Sunset statements.",
    // Ordered to follow the monthly flow: code the bills, decide what the client
    // is billed for, then push the month into the tracking sheets.
    dests: [
      { label: "Tracking Sheets", href: "/trackingsheet", desc: "Code a month's bills against live budget headroom", view: "recode" },
      { label: "Labor Review", href: "/labor-review", desc: "Code a month's logged time against the same headroom", view: "labor-review" },
      { label: "Invoice Review", href: "/invoice-review", desc: "Check a month's client invoices against the bills and the backup", view: "invoice-review" },
      { label: "Sunset Statements", href: "/payments", desc: "Pay a statement & reconcile its invoices", view: "payments" },
      { label: "Bill Search", href: "/bill-search", desc: "Find any bill or line item — “2x4”, a vendor, an invoice #", view: "bill-search" },
      { label: "Needs Review", href: "/needs-review", desc: "Bills flagged for a billing correction", view: "bill-review" },
      { label: "Clients & Jobs", href: "/clients", desc: "Every customer and job in JobTread — edit the record", view: "clients" },
      { label: "Vendors", href: "/vendors", desc: "Search a vendor's bills — job, date, amount", view: "vendors" },
      { label: "Expenditure History", href: "/expenditure-history", desc: "The sheet's archive, including the years before JobTread", view: "expenditure-history" },
    ],
  },
  {
    id: "hr",
    title: "HR",
    blurb: "Roster, labor, and safety.",
    dests: [
      { label: "Leads", href: "/leads", desc: "New leads, who's overdue, who's gone quiet", view: "leads" },
      { label: "Employees", href: "/employees", desc: "The Project Database roster", view: "employees" },
      { label: "Labor Import", href: "/labor-import", desc: "QuickBooks labor → JobTread CSV", view: "labor-import" },
      { label: "Labor Rates", href: "/labor-rates", desc: "Per-project pay rates & who has them", view: "labor-rates" },
      { label: "Safety Meeting", href: "/safety-meeting", desc: "Pass the iPad and collect sign-ins", view: "safety-meeting" },
    ],
  },
  {
    id: "utilities",
    title: "Utilities",
    blurb: "Everything else — imports, assistant, records, and script jobs.",
    dests: [
      { label: "Unbilled", href: "/unbilled", desc: "Uninvoiced expenses by cost code", view: "unbilled" },
      { label: "Receivables", href: "/ar-aging", desc: "Unpaid client invoices, oldest first", view: "ar-aging" },
      { label: "Email Invoices", href: "/email", desc: "Log invoices from the office inbox", view: "email" },
      { label: "Needs Project", href: "/needs-project", desc: "Ingested bills with no job yet", view: "needs-project" },
      { label: "Amazon Import", href: "/amazon-import", desc: "Monthly Amazon report → batch of bills", view: "amazon-import" },
      { label: "LSWDD Statement", href: "/lswdd", desc: "Split the dump's monthly statement across jobs", view: "lswdd" },
      { label: "Assistant", href: "/chat", desc: "Ask about a job's bills or budget", view: "chat" },
      { label: "RFIs", href: "/rfis", desc: "View and create a job's RFIs", view: "rfis" },
      { label: "Time Sync", href: "/time-sync", desc: "Records not yet in JobTread — retry", view: "time-sync" },
      { label: "Requests", href: "/requests", desc: "Ask for fixes and new features", view: "requests" },
      { label: "Actions", href: "/actions", desc: "Run a script job on demand", view: "actions" },
      { label: "Changelog", href: "/changelog", desc: "What changed in the app, and what is still unfinished", view: "changelog" },
    ],
  },
  {
    id: "admin",
    title: "Admin",
    blurb: "Access control and the automation audit log.",
    dests: [
      { label: "Admin", href: "/admin", desc: "Who can sign in", view: "admin" },
      { label: "Logs", href: "/logs", desc: "The automation audit trail", view: "logs" },
      { label: "Financial Journal", href: "/journal", desc: "Who changed which bill, line or time entry — and from what", view: "journal" },
      { label: "Historical Cost Import", href: "/historical-cost", desc: "Backfill a job's pre-JobTread costs as one draft bill", view: "historical-cost" },
      { label: "Page Text", href: "/admin/copy", desc: "Reword the app's on-screen text", view: "page-copy" },
      { label: "Course", href: "/course", desc: "Learn how this app works, one segment at a time", view: "course" },
    ],
  },
];

/**
 * ── The TILE launchers (field + lead + office) ────────────────────────────
 *
 * A field, lead, or office user's home page is NOT the area lists above. It is
 * a grid of large buttons: the pages that role opens all day, plus one final
 * button — "The Rest" — that opens /more, a plain menu of everything else they
 * may open.
 *
 *   field  — 4 buttons: Miles · Time · Tools · The Rest. No search box either
 *            (see AppHeader): the four buttons are the whole app. No bottom
 *            tab bar either — the same shortcuts, so a second row would repeat
 *            the grid one screen down. See TabBar.tsx.
 *   lead   — 6 buttons: the field three plus Tracking Sheets and Requisitions,
 *            then The Rest. Leads keep the header search box AND the bottom
 *            tab bar — TabBar's own default 3 (Tracking Sheets/Time/Miles)
 *            duplicate three of these six, which reads as "redundant" the way
 *            field's did; unlike field, a lead's grid is 6 wide rather than a
 *            clean subset of the bar's 3, so the bar stays off for lead only
 *            by role check in TabBar.tsx, not by shrinking the grid.
 *   office — 4 buttons: Tools · Requisitions · Time Off · The Rest. Office
 *            KEEPS the bottom tab bar (Tracking Sheets/Time/Miles), so those
 *            three are deliberately left OFF this grid — see OFFICE_REST
 *            below, which excludes them for the same reason.
 *
 * Admin is unaffected — it gets the AREAS lists above.
 *
 * TO CURATE A ROLE'S BUTTONS, edit TILE_LAUNCHERS below — this is the only
 * place to change. Three rules:
 *   • A destination shows only if the role also GRANTS its view (see ROLE_VIEWS
 *     / the Role Defaults editor on /admin). So you can list an entry before
 *     granting it — it stays hidden until you do.
 *   • `quick` is the buttons; `rest` is what the final button's menu lists.
 *     Anything in neither list is unreachable for that role, even if granted.
 *   • The Rest is added automatically as the last button; don't list it.
 */
export interface TileLauncher {
  /** The big buttons, in grid order. */
  quick: Dest[];
  /** What "The Rest" lists, in menu order. */
  rest: Dest[];
}

// The everyday few, shared across tile roles. `label` here is the SHORT
// button word (the launcher reads home.quick.<view>.label first, so the office
// can reword it); the long name is what /more and search show.
const TILE_MILES: Dest = { label: "Miles", href: "/mileage-tracker", desc: "Track your mileage", view: "mileage" };
const TILE_TIME: Dest = { label: "Time", href: "/employee-time", desc: "Log and review your hours", view: "employee-time" };
const TILE_TOOLS: Dest = { label: "Tools", href: "/tools", desc: "The tool tracker", view: "tools" };
const TILE_SHEETS: Dest = { label: "Tracking Sheets", href: "/trackingsheet", desc: "Code a month's bills against live budget headroom", view: "recode" };
const TILE_REQS: Dest = { label: "Requisitions", href: "/requisitions", desc: "Request materials & supplies", view: "requisitions" };
const TILE_TIME_OFF: Dest = { label: "Time Off", href: "/time-off", desc: "Request time off & see your balance", view: "time-off" };

// Menu rows both field and lead get. Entries a role doesn't grant simply don't
// render, so one list serves both (a field user sees the first two today).
const REST_COMMON: Dest[] = [
  TILE_TIME_OFF,
  { label: "Safety Meeting", href: "/safety-meeting", desc: "Pass the iPad and collect sign-ins", view: "safety-meeting" },
  { label: "RFIs", href: "/rfis", desc: "View and create a job's RFIs", view: "rfis" },
  { label: "Requests", href: "/requests", desc: "Ask for fixes and new features", view: "requests" },
  { label: "Assistant", href: "/chat", desc: "Ask about a job's bills or budget", view: "chat" },
];

// Office's grid leaves off Tracking Sheets, Miles, and Time — the bottom tab
// bar already carries them for this role (see the header comment above and
// TabBar.tsx's TAB_CANDIDATES). Its "rest" menu is everything ELSE office can
// reach: every AREAS destination minus those three and minus the three grid
// buttons, so this stays derived from the one list rather than a second copy
// that can drift from it as pages are added.
const OFFICE_GRID_VIEWS = new Set(["tools", "requisitions", "time-off"]);
const OFFICE_TABBAR_VIEWS = new Set(["recode", "mileage", "employee-time"]);
const OFFICE_REST: Dest[] = AREAS.flatMap((a) => a.dests).filter(
  (d) => !OFFICE_GRID_VIEWS.has(d.view) && !OFFICE_TABBAR_VIEWS.has(d.view),
);

export const TILE_LAUNCHERS: Record<string, TileLauncher> = {
  field: {
    quick: [TILE_MILES, TILE_TIME, TILE_TOOLS],
    // Requisitions is a menu row for a field user and a BUTTON for a lead —
    // same page, different prominence, which is the whole point of two lists.
    rest: [REST_COMMON[0], TILE_REQS, ...REST_COMMON.slice(1)],
  },
  lead: {
    quick: [TILE_MILES, TILE_TIME, TILE_TOOLS, TILE_SHEETS, TILE_REQS],
    // The billing pages a lead reaches beyond the Tracking Sheets button.
    rest: [
      { label: "Sunset Statements", href: "/payments", desc: "Pay a statement & reconcile its invoices", view: "payments" },
      { label: "Bill Search", href: "/bill-search", desc: "Find any bill or line item — a vendor, an invoice #", view: "bill-search" },
      { label: "Labor Review", href: "/labor-review", desc: "Code a month's logged time against the same headroom", view: "labor-review" },
      ...REST_COMMON,
    ],
  },
  office: {
    quick: [TILE_TOOLS, TILE_REQS, TILE_TIME_OFF],
    rest: OFFICE_REST,
  },
};

/** The tile launcher for a role, or null for the roles that get AREAS. */
export function tileLauncherFor(role: string | null | undefined): TileLauncher | null {
  return (role && TILE_LAUNCHERS[role]) || null;
}

/** Where the final button goes. */
export const MORE_HREF = "/more";
