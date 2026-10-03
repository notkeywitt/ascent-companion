/**
 * THE ONE LIST OF PAGES — every page, grouped into WORKSPACES named for a job
 * the office repeats (NAVIGATION_PLAN.md). Pure data, so the header menu, the
 * bottom bar, the header search and the tests all read the same thing.
 *
 * A workspace is navigation laid OVER existing pages. Every tab keeps its route
 * and its view id, so saved links, per-user grants and page copy keep working.
 * A tab is shown only to someone who holds its view; a workspace with no tab a
 * person can open is not shown to them at all.
 *
 * A new page must be a tab here, or be named in OUTSIDE_WORKSPACES with the
 * reason — src/lib/workspaces.test.ts fails otherwise. That test replaces the
 * old rule "a new view must appear in AREAS or it becomes dead".
 *
 * Labels: `label`/`desc` are the defaults. The screen reads the copy registry
 * first (`home.dest.<view>.label` / `.desc`, src/lib/copy.ts), so the office
 * can reword a page in Admin → Page Text.
 */
import type { Role } from "@/lib/views";

export interface WorkspaceTab {
  /** The views.ts gate id. */
  view: string;
  href: string;
  label: string;
  desc: string;
}

export interface Workspace {
  id: string;
  title: string;
  desc: string;
  tabs: WorkspaceTab[];
}

const tab = (view: string, href: string, label: string, desc: string): WorkspaceTab => ({
  view,
  href,
  label,
  desc,
});

export const WORKSPACES: Workspace[] = [
  {
    id: "close",
    title: "Invoicing",
    desc: "Code the month, check it, bill it — in close order.",
    // The close order, confirmed by the owner 2026-09-29 (decision 9).
    tabs: [
      tab("recode", "/trackingsheet", "Tracking Sheets", "Code a month's bills against live budget headroom"),
      tab("labor-review", "/labor-review", "Labor Review", "Code a month's logged time against the same headroom"),
      tab("bill-review", "/needs-review", "Bill Corrections", "Bills flagged for a billing correction"),
      tab("taxable-lines", "/taxable-lines", "Taxable Flags", "Bill lines the client invoice will not tax"),
      tab("invoice-review", "/invoice-review", "Invoice Review", "Check a month's client invoices against the bills and the backup"),
      tab("invoicing-summary", "/invoicing-summary", "Invoicing Package", "The month's billing summary doc — every job, its labor, bills and total"),
      tab("tracking-sheet", "/tracking-sheet", "Finalize", "Push a job's month into its own Google tracking sheet"),
    ],
  },
  {
    id: "incoming",
    title: "Incoming Bills",
    desc: "Bills arriving from the inbox, the mail and the monthly statements.",
    tabs: [
      tab("email", "/email", "Email Invoices", "Log invoices from the office inbox"),
      tab("vendor-mail", "/vendor-mail", "Mail Check", "Every vendor email, and whether it was captured"),
      tab("needs-project", "/needs-project", "Not in JobTread", "Ingested bills with no job yet"),
      tab("payments", "/payments", "Sunset Statements", "Pay a statement & reconcile its invoices"),
      tab("lswdd", "/lswdd", "LSWDD Statement", "Split the dump's monthly statement across jobs"),
      tab("amazon-import", "/amazon-import", "Amazon Import", "Monthly Amazon report → batch of bills"),
    ],
  },
  {
    id: "clients",
    title: "Clients",
    desc: "Leads, clients and jobs — budgets, specs and what is owed.",
    // RFIs left every menu 2026-09-29: nobody logs them (owner decision 4).
    // The route and the view stay; see OUTSIDE_WORKSPACES.
    tabs: [
      tab("leads", "/leads", "Leads", "New leads, who's overdue, who's gone quiet"),
      tab("clients", "/clients", "Directory", "Every customer and job in JobTread — edit the record"),
      tab("jobs", "/jobs", "Job Cost", "Every job's budget against what it has spent"),
      tab("unbilled", "/unbilled", "Unbilled", "Uninvoiced expenses by cost code"),
      tab("budget-import", "/budget-import", "Budget Import", "A tracking sheet's estimate as a JobTread budget"),
      tab("specs", "/specs", "Specifications", "An architect's spec selection list, with its product links"),
      tab("ar-aging", "/ar-aging", "Receivables", "Unpaid client invoices, oldest first"),
    ],
  },
  {
    id: "people",
    title: "People",
    desc: "The roster, pay rates, time records and the safety meeting.",
    tabs: [
      tab("employees", "/employees", "Employees", "The Project Database roster"),
      tab("labor-rates", "/labor-rates", "Pay Rates", "Per-project pay rates & who has them"),
      tab("time-off-admin", "/time-off/office", "Time Off (Office)", "Requests to approve, balances, accrual and policy"),
      tab("time-sync", "/time-sync", "Time Sync", "Time records JobTread doesn't have right"),
      tab("labor-import", "/labor-import", "Labor Import", "QuickBooks labor → JobTread CSV"),
      tab("safety-meeting", "/safety-meeting", "Safety Meeting", "Pass the iPad and collect sign-ins"),
    ],
  },
  {
    id: "search",
    title: "Search",
    desc: "Find a bill, a line item or a vendor, in JobTread or before it.",
    tabs: [
      tab("bill-search", "/bill-search", "Bill Search", "Find any bill or line item — “2x4”, a vendor, an invoice #"),
      tab("vendors", "/vendors", "Vendors", "Search a vendor's bills — job, date, amount"),
      tab("expenditure-history", "/expenditure-history", "Bill Archive", "The sheet's archive, including the years before JobTread"),
    ],
  },
  {
    id: "office",
    title: "Office",
    desc: "The Office job, the team's notices, and the script jobs.",
    tabs: [
      tab("office", "/office", "Office Dashboard", "The Office job's to-dos and files"),
      tab("notices", "/notices", "Notices", "Post a banner to the team — now or scheduled"),
      tab("actions", "/actions", "Actions", "Run a script job on demand"),
    ],
  },
  {
    id: "mywork",
    title: "My Work",
    desc: "Your time, miles, tools, requisitions and time off.",
    tabs: [
      tab("employee-time", "/employee-time", "Time", "Log and review your hours"),
      tab("mileage", "/mileage-tracker", "Miles", "Track your mileage"),
      tab("tools", "/tools", "Tools", "The tool tracker"),
      tab("requisitions", "/requisitions", "Requisitions", "Request materials & supplies"),
      tab("time-off", "/time-off", "Time Off", "Request time off & see your balance"),
    ],
  },
  {
    id: "help",
    title: "Help",
    desc: "How the app works, what changed, and where to ask for more.",
    tabs: [
      tab("help", "/help", "Help", "How to do the things this app does, step by step"),
      tab("changelog", "/changelog", "Changelog", "What changed in the app, and what is still unfinished"),
      tab("requests", "/requests", "App Feedback", "Ask for fixes and new features"),
      tab("course", "/course", "Course", "Learn how this app works, one segment at a time"),
    ],
  },
  {
    id: "admin",
    title: "Admin",
    desc: "Access, the app's wording and look, and the audit trails.",
    tabs: [
      tab("admin", "/admin", "Access", "Who can sign in, and what each role can open"),
      tab("page-copy", "/admin/copy", "Page Text", "Reword the app's on-screen text"),
      tab("theme-editor", "/theme", "Theme", "Tune the palette with pickers and sliders, and see it live"),
      tab("logs", "/logs", "System Logs", "The automation audit trail"),
      tab("journal", "/journal", "Financial Journal", "Who changed which bill, line or time entry — and from what"),
      tab("historical-cost", "/historical-cost", "Historical Cost Import", "Backfill a job's pre-JobTread costs as one draft bill"),
    ],
  },
];

/**
 * Pages that are reachable but on no workspace, and why. The menu shows the
 * first two in its footer.
 */
export const EXTRA_LINKS: WorkspaceTab[] = [
  tab("chat", "/chat", "Assistant", "Ask about a job's bills or budget"),
  tab("lopezrocks", "/lopezrocks", "LopezRocks", "Lopez Island's community board"),
];
export const OUTSIDE_WORKSPACES: Record<string, string> = {
  chat: "menu footer (EXTRA_LINKS)",
  lopezrocks: "menu footer (EXTRA_LINKS) and the home page",
  rfis: "nobody logs RFIs (owner decision 4, 2026-09-29); route kept",
};

/**
 * Pages that show no tab strip. The safety meeting is passed around the room
 * on an iPad; a row of other pages above the sign-in is a way to lose it.
 */
export const NO_STRIP = new Set(["safety-meeting"]);

/** Workspaces that show no tab strip on any of their pages. Invoicing dropped
 * its strip at the owner's ask (2026-10-03); the ☰ menu still lists its pages. */
export const NO_STRIP_WORKSPACES = new Set(["close"]);

/** Today — the home page. Not a workspace: it is the bar's first slot. */
export const TODAY: WorkspaceTab = tab("", "/", "Home", "What needs you today");

/** The tabs of a workspace this person can open. */
export function reachableTabs(ws: Workspace, can: (view: string) => boolean): WorkspaceTab[] {
  return ws.tabs.filter((t) => can(t.view));
}

const within = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** The workspace and tab a pathname belongs to, longest route first. */
export function locate(pathname: string): { workspace: Workspace; tab: WorkspaceTab } | null {
  let best: { workspace: Workspace; tab: WorkspaceTab } | null = null;
  for (const workspace of WORKSPACES) {
    for (const t of workspace.tabs) {
      if (within(pathname, t.href) && (!best || t.href.length > best.tab.href.length)) {
        best = { workspace, tab: t };
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ bars */

/** One slot on the bottom bar: Today, a whole workspace, or a single page. */
export type BarSlot =
  | { kind: "today" }
  | { kind: "workspace"; id: string }
  | { kind: "tab"; view: string };

/**
 * Each role's bar (NAVIGATION_PLAN.md, "Bars by role"). Office carries Miles in
 * place of Clients (owner decision 2). A slot the person cannot open is skipped.
 */
export const BARS: Record<Role, BarSlot[]> = {
  field: [
    { kind: "tab", view: "employee-time" },
    { kind: "tab", view: "mileage" },
    { kind: "tab", view: "tools" },
    { kind: "tab", view: "requisitions" },
    { kind: "tab", view: "time-off" },
  ],
  lead: [
    { kind: "today" },
    { kind: "tab", view: "employee-time" },
    { kind: "tab", view: "mileage" },
    { kind: "tab", view: "tools" },
    { kind: "tab", view: "requisitions" },
  ],
  office: [
    { kind: "today" },
    { kind: "workspace", id: "close" },
    { kind: "workspace", id: "incoming" },
    { kind: "tab", view: "mileage" },
    { kind: "workspace", id: "mywork" },
  ],
  admin: [
    { kind: "today" },
    { kind: "workspace", id: "close" },
    { kind: "workspace", id: "incoming" },
    { kind: "workspace", id: "office" },
    { kind: "workspace", id: "mywork" },
  ],
};

/** A resolved bar slot: where it goes, what it says, and which pages light it. */
export interface BarItem {
  key: string;
  label: string;
  href: string;
  /** The view that names its icon and its copy label ("" for Today). */
  view: string;
  /** Workspace id, when the slot is a workspace. */
  workspace?: string;
  /** Routes that mark the slot as the current one. */
  covers: string[];
}

const TAB_BY_VIEW = new Map(WORKSPACES.flatMap((w) => w.tabs.map((t) => [t.view, t] as const)));

/** Where the device's pinned page is kept (a view id). Per device, like the old drawer's pins. */
export const BAR_PIN_KEY = "bar.pin";
/** Fired on `window` when the pin changes, so the bar updates without a reload. */
export const BAR_PIN_EVENT = "bar-pin";

/**
 * The role's bar. `pin` is the page this person pinned from the menu: it takes
 * the LAST slot (or joins a bar with room), unless it is already on the bar or
 * they cannot open it.
 */
export function barFor(role: Role, can: (view: string) => boolean, pin = ""): BarItem[] {
  const out: BarItem[] = [];
  for (const slot of BARS[role] ?? BARS.field) {
    if (slot.kind === "today") {
      out.push({ key: "today", label: TODAY.label, href: "/", view: "", covers: ["/"] });
    } else if (slot.kind === "tab") {
      const t = TAB_BY_VIEW.get(slot.view);
      if (t && can(t.view)) out.push({ key: t.view, label: t.label, href: t.href, view: t.view, covers: [t.href] });
    } else {
      const ws = WORKSPACES.find((w) => w.id === slot.id);
      const tabs = ws ? reachableTabs(ws, can) : [];
      if (ws && tabs.length) {
        out.push({
          key: ws.id,
          label: ws.title,
          href: tabs[0].href,
          view: tabs[0].view,
          workspace: ws.id,
          covers: tabs.map((t) => t.href),
        });
      }
    }
  }
  const t = pin ? TAB_BY_VIEW.get(pin) ?? EXTRA_LINKS.find((e) => e.view === pin) : undefined;
  if (t && can(t.view) && !out.some((i) => i.view === t.view && !i.workspace)) {
    const item = { key: t.view, label: t.label, href: t.href, view: t.view, covers: [t.href] };
    if (out.length >= 5) out[out.length - 1] = item;
    else out.push(item);
  }
  return out;
}

/**
 * The iPad rail and desktop sidebar: the bar's slots first, in the bar's order,
 * then every other workspace this person can open. The rail has the height the
 * bar lacks, so nothing has to be left for the menu.
 */
export function railFor(role: Role, can: (view: string) => boolean, pin = ""): BarItem[] {
  const out = barFor(role, can, pin);
  for (const ws of WORKSPACES) {
    if (out.some((i) => i.workspace === ws.id)) continue;
    const tabs = reachableTabs(ws, can);
    if (tabs.length) {
      out.push({ key: ws.id, label: ws.title, href: tabs[0].href, view: tabs[0].view, workspace: ws.id, covers: tabs.map((t) => t.href) });
    }
  }
  return out;
}

/**
 * The slot that marks where the person is. A single-page slot beats a workspace
 * that also holds that page (office has Miles AND My Work), and Today is only
 * ever "/".
 */
export function activeBarKey(items: BarItem[], pathname: string): string {
  const hits = items.filter((i) =>
    i.key === "today" ? pathname === "/" : i.covers.some((href) => within(pathname, href)),
  );
  return (hits.find((i) => !i.workspace) ?? hits[0])?.key ?? "";
}
