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
      { label: "Client Invoicing", href: "/recode", desc: "Code a month's bills against live budget headroom", view: "recode" },
      { label: "Labor Review", href: "/labor-review", desc: "Code a month's logged time against the same headroom", view: "labor-review" },
      { label: "Tracking Sheet", href: "/tracking-sheet", desc: "Push a job's month into its tracking sheet", view: "tracking-sheet" },
      { label: "Sunset Statements", href: "/payments", desc: "Pay a statement & reconcile its invoices", view: "payments" },
      { label: "Bill Search", href: "/bill-search", desc: "Find any bill or line item — “2x4”, a vendor, an invoice #", view: "bill-search" },
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
      { label: "Email Invoices", href: "/email", desc: "Log invoices from the office inbox", view: "email" },
      { label: "Needs Project", href: "/needs-project", desc: "Ingested bills with no job yet", view: "needs-project" },
      { label: "Amazon Import", href: "/amazon-import", desc: "Monthly Amazon report → batch of bills", view: "amazon-import" },
      { label: "LSWDD Statement", href: "/lswdd", desc: "Split the dump's monthly statement across jobs", view: "lswdd" },
      { label: "Assistant", href: "/chat", desc: "Ask about a job's bills or budget", view: "chat" },
      { label: "RFIs", href: "/rfis", desc: "View and create a job's RFIs", view: "rfis" },
      { label: "Time Sync", href: "/time-sync", desc: "Records not yet in JobTread — retry", view: "time-sync" },
      { label: "Requests", href: "/requests", desc: "Ask for fixes and new features", view: "requests" },
      { label: "Actions", href: "/actions", desc: "Run a script job on demand", view: "actions" },
    ],
  },
  {
    id: "admin",
    title: "Admin",
    blurb: "Access control and the automation audit log.",
    dests: [
      { label: "Admin", href: "/admin", desc: "Who can sign in", view: "admin" },
      { label: "Logs", href: "/logs", desc: "The automation audit trail", view: "logs" },
      { label: "Historical Cost Import", href: "/historical-cost", desc: "Backfill a job's pre-JobTread costs as one draft bill", view: "historical-cost" },
      { label: "Page Text", href: "/admin/copy", desc: "Reword the app's on-screen text", view: "page-copy" },
      { label: "Course", href: "/course", desc: "Learn how this app works, one segment at a time", view: "course" },
    ],
  },
];
