/**
 * The single source of truth for role-gated views.
 *
 * Pure constants + pure functions only — NO DB, Node, or React imports — so this
 * module is safe to import from middleware (edge runtime), server components, and
 * client components alike. Both the home launcher and the tab bar filter their
 * links through `resolveAllowedViews`, and the middleware enforces the same rule
 * server-side via `viewIdForPath`.
 *
 * To add a gateable page: add a VIEW entry (with the route prefixes that belong
 * to it) and, if it shouldn't be admin-only, add its id to the relevant role in
 * ROLE_VIEWS. Nav entries reference views by `id`.
 *
 * A view's `paths` may name an API route as well as a page — that's how a
 * control with no page of its own (the Sync button → /api/jt-sync) gets gated
 * server-side by the same middleware rule as everything else.
 */

export type Role = "admin" | "office" | "lead" | "field";
export const ROLES: Role[] = ["admin", "office", "lead", "field"];

export type ViewGroup = "Financials" | "Field" | "Assistant" | "Office" | "System";

export interface ViewDef {
  id: string;
  /** Route prefixes that belong to this view (segment-boundary matched). */
  paths: string[];
  group: ViewGroup;
  /** Short human label for the admin override editor. */
  label: string;
}

/**
 * Every gateable view. `paths[0]` is the canonical route; extra paths are child
 * routes that share the same gate (e.g. /bill + /add-bill live under Coding).
 */
export const VIEWS: ViewDef[] = [
  // Financials / billing — admin-only as a group (see ADMIN_ONLY below).
  // RETIRED 2026-08-10: the standalone Coding Review page. Its queue is now the
  // "Needs coding" tab of Client Invoicing, and nothing links here any more —
  // the route is left reachable by URL as a transition fallback, so the gate
  // stays. The bill pages it used to own moved to the "recode" view below,
  // which is what actually links to them now.
  { id: "coding", label: "Coding Review (retired)", group: "Financials", paths: ["/coding"] },
  // Client Invoicing — the whole billing workflow on one route: the month's
  // invoices across every job, the needs-coding queue, and the per-job coding
  // workbench (which WRITES coding, unlike the read-only pages it absorbed).
  // /bill and /add-bill ride this gate because it is the only surface that
  // reaches them. So does /api/uncaptured — unlike the read-only /api/stage
  // routes below, it pushes bills to JobTread and can delete a sheet row and
  // trash its PDF, so it must not be callable by a role that can't see the page.
  {
    id: "recode",
    label: "Client Invoicing",
    group: "Financials",
    paths: ["/recode", "/api/recode", "/bill", "/add-bill", "/api/uncaptured"],
  },
  // Labor Review — Client Invoicing's workbench applied to time entries: the
  // same budget rail, the month's labor in place of the bills, and a coding
  // drawer that re-points a time entry's cost item. It WRITES to JobTread
  // (updateTimeEntry), so the API prefix rides the same gate as the page — a
  // role without the view must not be able to recode labor via the route.
  {
    id: "labor-review",
    label: "Labor Review",
    group: "Financials",
    paths: ["/labor-review", "/api/labor-review"],
  },
  // Approving a bill (draft → pending/approved) can push it to QuickBooks, so it
  // sits behind its own gate rather than riding on "recode" — leads keep coding
  // access without the approval action. No page of its own.
  { id: "bill-approve", label: "Bill Approval", group: "Financials", paths: ["/api/bill-status"] },
  // Per-project Google tracking sheets. The API prefix is listed alongside the
  // page so a role without the view can't push to a job's sheet by calling the
  // route directly.
  {
    id: "tracking-sheet",
    label: "Tracking Sheet",
    group: "Financials",
    paths: ["/tracking-sheet", "/api/tracking-sheet"],
  },
  // Jobs list + budget, built on the generic /api/pave gateway. Office+admin by
  // default (financial data); not in FIELD/LEAD sets below.
  { id: "jobs", label: "Jobs", group: "Financials", paths: ["/jobs"] },
  // RETIRED 2026-08-10 alongside "coding": the standalone Invoicing page is now
  // the "This month" tab of Client Invoicing. Unlinked but still reachable by
  // URL, so the gate stays. NOTE the /api/stage routes are deliberately NOT
  // listed — Client Invoicing reads them for its roster and billing summary, so
  // gating them here would lock out anyone without this retired view.
  { id: "stage", label: "Invoicing (retired)", group: "Financials", paths: ["/stage"] },
  { id: "unbilled", label: "Unbilled", group: "Financials", paths: ["/unbilled"] },
  // Vendor bill search — job, date, amount, status, per vendor or per bill
  // number. A distinct API prefix ("/api/vendor-bills") from the existing
  // shared "/api/vendors" name+id list, which stays ungated (add-bill, RFIs,
  // and Amazon Import all read it regardless of who has this view).
  { id: "vendors", label: "Vendors", group: "Financials", paths: ["/vendors", "/api/vendor-bills"] },
  // The stuck-vendor alert (popup + home banner) rides on this gate: its API
  // route is listed here so a non-billing user can neither see the warning nor
  // read the bill list behind it by calling the route directly.
  { id: "email", label: "Email Invoices", group: "Financials", paths: ["/email", "/api/stuck-vendors"] },
  // The home-page count badge + banner ride on this gate too, so its API route is
  // listed here (same reasoning as `email` above): a non-billing user can neither
  // see the indicator nor read the queued bills by calling the route directly.
  { id: "needs-project", label: "Needs Project", group: "Financials", paths: ["/needs-project", "/api/needs-project"] },
  { id: "payments", label: "Sunset Statements", group: "Financials", paths: ["/payments"] },
  { id: "amazon-import", label: "Amazon Import", group: "Financials", paths: ["/amazon-import", "/api/amazon-import"] },
  // Field
  { id: "safety-meeting", label: "Safety Meeting", group: "Field", paths: ["/safety-meeting"] },
  { id: "mileage", label: "Mileage", group: "Field", paths: ["/mileage-tracker"] },
  { id: "employee-time", label: "Employee Time", group: "Field", paths: ["/employee-time"] },
  { id: "tools", label: "Tools", group: "Field", paths: ["/tools", "/tool-tracker"] },
  { id: "rfis", label: "RFIs", group: "Field", paths: ["/rfis"] },
  // Time off — the accrual/balance page. Field employees get the self-service
  // view (own balance + request time off, via /api/time-off/me and POST/GET
  // /api/time-off/requests); office/admin additionally get the management
  // controls behind "time-off-admin" below (including PATCH on /requests, which
  // that route authorizes in-handler since middleware can't split by method).
  {
    id: "time-off",
    label: "Time Off",
    group: "Field",
    paths: ["/time-off", "/api/time-off/me", "/api/time-off/requests"],
  },
  // Leads submit; office/admin track. The API route is listed alongside so a
  // role without the view can't reach the data by calling the route directly.
  { id: "requisitions", label: "Requisitions", group: "Field", paths: ["/requisitions", "/api/requisitions"] },
  // Assistant
  { id: "chat", label: "Assistant", group: "Assistant", paths: ["/chat"] },
  // Office
  // The email-blast API is listed here so it inherits the office/admin gate; the
  // page-less /api/employees (read/edit) stays ungated because /safety-meeting
  // (a field view) reads the Active roster through it.
  { id: "employees", label: "Employees", group: "Office", paths: ["/employees", "/api/employees/email"] },
  // Lead pipeline — JobTread's "New Lead" customers plus the Companion's
  // follow-up tracking. The API prefix is listed alongside the page so a role
  // without the view can't read customer contact details via the route directly.
  // Office/admin by default (not in FIELD/LEAD sets below).
  { id: "leads", label: "Leads", group: "Office", paths: ["/leads", "/api/leads"] },
  { id: "labor-import", label: "Labor Import", group: "Office", paths: ["/labor-import"] },
  // Per-project labor-rate catalog + apply-to-employees. The API prefix gates all
  // /api/labor-rates/* routes (catalog CRUD, member list, and the JobTread write)
  // so a non-office user can't read or edit pay rates via the routes directly.
  { id: "labor-rates", label: "Labor Rates", group: "Office", paths: ["/labor-rates", "/api/labor-rates"] },
  // Accrual management APIs — office/admin only (no field grant, not admin-only,
  // so office gets it by default). No page of its own; the office controls live
  // on the shared /time-off page and call these routes.
  {
    id: "time-off-admin",
    label: "Time Off (Office)",
    group: "Office",
    paths: [
      "/api/time-off/accrual",
      "/api/time-off/policies",
      "/api/time-off/balances",
      "/api/time-off/ledger",
    ],
  },
  // Reconciliation — records captured but not yet in JobTread, with retry.
  // Office/admin (not field, not admin-only).
  { id: "time-sync", label: "Time Sync", group: "Office", paths: ["/time-sync", "/api/time-sync"] },
  // System
  // Bulk-writes a real JobTread draft bill — admin only, not office (unlike
  // every other Financials view). The API prefix is listed alongside so a
  // non-admin can't reach it by calling the route directly.
  {
    id: "historical-cost",
    label: "Historical Cost Import",
    group: "System",
    paths: ["/historical-cost", "/api/historical-cost"],
  },
  // No page of its own — this gates the route that hands out Ascent's bank
  // routing/account numbers for the Sunset payment form. /payments itself is a
  // LEAD view, so the numbers can't ride that gate; they get their own,
  // admin-only one (see ADMIN_MENU below) and the chips render only when the
  // route answers. The numbers live in server-only env vars, never in the DB.
  { id: "bank-details", label: "Bank Details", group: "System", paths: ["/api/bank-details"] },
  { id: "requests", label: "Requests", group: "System", paths: ["/requests"] },
  // The API route is listed alongside the page so the Home launcher's admin
  // action bar — buttons on a page EVERY role loads — can't be driven by a
  // non-admin who POSTs /api/actions directly.
  { id: "actions", label: "Actions", group: "System", paths: ["/actions", "/api/actions"] },
  { id: "admin", label: "Admin", group: "System", paths: ["/admin"] },
  { id: "logs", label: "Logs", group: "System", paths: ["/logs"] },
  // No page of its own — this gates the header's Sync button and the API route
  // behind it, so a non-admin can neither see nor POST the full JT sync.
  { id: "sync", label: "Sync Now", group: "System", paths: ["/api/jt-sync"] },
];

export const ALL_VIEW_IDS: string[] = VIEWS.map((v) => v.id);

/**
 * Base view sets, as a nested role hierarchy: field ⊂ lead ⊂ office ⊂ admin.
 * A per-user grant/denial in the admin editor still adjusts any individual on
 * top of these.
 *
 * Field = every employee: the four one-tap launcher buttons plus self-service
 * time off (everyone must be able to request time off). Leads add the
 * Financials menu. Office adds everything except the admin consoles. Admin gets
 * all of it.
 */
// The four launcher quick buttons + self-service Time Off — granted to all.
const FIELD_VIEWS: string[] = ["mileage", "employee-time", "tools", "requisitions", "time-off"];
// Leads additionally see the Financials menu (coding, invoicing, Sunset pay).
const LEAD_VIEWS: string[] = [...FIELD_VIEWS, "coding", "stage", "recode", "payments"];
// The admin-only consoles — access control + the audit log. No one below admin
// gets these by default (a per-user grant can still hand them to an individual).
const ADMIN_MENU: string[] = ["admin", "logs", "historical-cost", "bank-details"];
// Office gets Financials, HR, and Utilities ("everything else") — i.e. every
// view except the admin consoles, including the header Sync button.
const OFFICE_VIEWS: string[] = ALL_VIEW_IDS.filter((id) => !ADMIN_MENU.includes(id));

/** Base view set granted by each role, before per-user overrides. */
export const ROLE_VIEWS: Record<Role, string[]> = {
  admin: ALL_VIEW_IDS,
  office: OFFICE_VIEWS,
  lead: LEAD_VIEWS,
  field: FIELD_VIEWS,
};

function asRole(role: string | null | undefined): Role {
  return role === "admin" || role === "office" || role === "lead" || role === "field"
    ? role
    : "field";
}

/**
 * The effective set of view ids a user can access:
 *   (role base ∪ per-user grants) \ per-user denials.
 * `allow`/`deny` are the parsed viewsAllow/viewsDeny arrays.
 *
 * `roleBase` overrides the starting point in place of the hardcoded
 * ROLE_VIEWS[role] — pass the DB-resolved per-role default (see auth.ts'
 * `roleBaseFor`) so a per-user override sits on top of what the role ACTUALLY
 * grants today, not the code default. Omit it to fall back to the hardcoded
 * default (e.g. when computing that DB-resolved base itself).
 */
export function resolveAllowedViews(
  role: string | null | undefined,
  allow: string[] = [],
  deny: string[] = [],
  roleBase?: Iterable<string>,
): Set<string> {
  const set = new Set<string>(roleBase ?? ROLE_VIEWS[asRole(role)]);
  for (const id of allow) set.add(id);
  for (const id of deny) set.delete(id);
  // Never grant a view id that no longer exists.
  return new Set([...set].filter((id) => ALL_VIEW_IDS.includes(id)));
}

/** Segment-boundary prefix match: "/tools" matches "/tools" and "/tools/x". */
function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Map a pathname to the view id that gates it, or null for ungated routes
 * (home, login, privacy, api/auth, …). Longest matching prefix wins.
 */
export function viewIdForPath(pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const v of VIEWS) {
    for (const p of v.paths) {
      if (pathMatches(pathname, p) && (!best || p.length > best.len)) {
        best = { id: v.id, len: p.length };
      }
    }
  }
  return best?.id ?? null;
}
