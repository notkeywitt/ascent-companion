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
      // Checks holds Bill Corrections and Taxable Flags as sections since
      // 2026-10-18 (CONSOLIDATION_PLAN.md stage 2); their routes redirect.
      tab("invoice-review", "/invoice-review", "Checks", "Findings, flagged bills and non-taxable lines for the month"),
      tab("invoicing-summary", "/invoicing-summary", "Invoice Status", "Every job billed this month — paid or open, emailed or opened, and the invoicing email"),
    ],
  },
  {
    // Its own menu row at the owner's ask (2026-10-16), out of People.
    id: "employees",
    title: "Employees",
    desc: "The roster — details, JobTread jobs and pay types.",
    tabs: [
      tab("employees", "/employees", "Employees", "The Project Database roster"),
      tab("new-hires", "/onboarding/office", "New Hires", "Invite a new hire, collect their signed forms"),
      tab("labor-rates", "/labor-rates", "Pay Rates", "Per-project pay rates & who has them"),
      tab("safety-meeting", "/safety-meeting", "Safety Meeting", "Pass the iPad and collect sign-ins"),
    ],
  },
  {
    id: "clients",
    // "Jobs" since 2026-10-18 (owner, decision 5), so the bar and the rail say
    // the same thing. The workspace id stays "clients".
    title: "Jobs",
    desc: "Jobs, leads and customers, and what is owed.",
    // RFIs left every menu 2026-09-29: nobody logs them (owner decision 4).
    // A job's own pages (Cost, Budget Import, Specs, Unbilled) left the menu
    // 2026-10-18: they open from the job's tab row (JobTabs) and JOB_PAGES
    // keeps them in the header search.
    tabs: [
      tab("job-board", "/job-board", "Job Board", "Active jobs, PreCon jobs and leads — the schedule now and the newest to-dos"),
      // Customers = Leads + Directory's list, as sections (stage 4).
      tab("leads", "/leads", "Customers", "Leads to follow up, and every customer and job"),
      tab("ar-aging", "/ar-aging", "Receivables", "Unpaid client invoices, oldest first"),
      tab("deposit-tracker", "/deposit-tracker", "Deposit Checks", "Photograph the checks, mark their invoices paid, email Sara and Casey"),
    ],
  },
  {
    // Its own menu row at the owner's ask (2026-10-16), out of My Work.
    id: "time",
    title: "Time",
    desc: "Log and review your hours.",
    tabs: [
      tab("employee-time", "/employee-time", "Time", "Log and review your hours"),
      // Payroll: time off, sync gaps and labor import as sections (stage 5).
      tab("time-sync", "/payroll", "Payroll", "Time off to approve, time JobTread doesn't have right, and the month's labor"),
    ],
  },
  {
    id: "incoming",
    // "Bills" since 2026-10-26 (owner), and it opens on the Bills list.
    title: "Bills",
    desc: "Bills to code, and bills arriving from the inbox, the mail and the monthly statements.",
    tabs: [
      tab("bills", "/bills", "Bills", "Draft bills to code, with the open bill beside the list"),
      // One inbox since 2026-10-18 (CONSOLIDATION_PLAN.md stage 3): To log,
      // Stuck (was Not in JobTread) and Check mail (was Mail Check) are its
      // sections; /needs-project and /vendor-mail redirect.
      tab("email", "/email", "Inbox", "Invoice emails to log, stuck bills, and the vendor mail check"),
      tab("payments", "/payments", "Sunset Statements", "Pay a statement & reconcile its invoices"),
      tab("lswdd", "/lswdd", "LSWDD Statement", "Split the dump's monthly statement across jobs"),
      tab("amazon-import", "/amazon-import", "Amazon Import", "Monthly Amazon report → batch of bills"),
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
    ],
  },
  {
    id: "mywork",
    title: "My Work",
    desc: "Your miles, tools, requisitions and time off.",
    tabs: [
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
      tab("requests", "/requests", "App Feedback", "Ask for fixes and new features"),
    ],
  },
  {
    id: "admin",
    title: "Admin",
    desc: "Access, the app's wording and look, and the audit trails.",
    tabs: [
      tab("admin", "/admin", "Access", "Who can sign in, and what each role can open"),
      tab("ascentbot", "/ascentbot", "AscentBot", "Who can ask the Chat bot, and what each role's answers may include"),
      // Pairs joined by a PageTabs row (stage 6): Look & Text opens Page Text
      // (Theme beside it), Audit opens System Logs (Financial Journal beside it).
      tab("page-copy", "/admin/copy", "Look & Text", "Reword the app's on-screen text, and tune the palette"),
      tab("logs", "/logs", "Audit", "The automation log and the financial journal — who changed what"),
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
/** A job's own pages: on no menu (the job's tab row reaches them), but still
 *  found by the header search. */
export const JOB_PAGES: WorkspaceTab[] = [
  tab("jobs", "/jobs", "Job Cost", "A job's budget against what it has spent"),
  tab("budget-import", "/budget-import", "Budget Import", "A tracking sheet's estimate as a JobTread budget"),
  tab("specs", "/specs", "Specifications", "An architect's spec selection list, with its product links"),
  tab("house-manual", "/house-manual", "House Manual", "A homeowner's manual to paste into Squarespace"),
  tab("unbilled", "/unbilled", "Unbilled", "A job's bills and time not yet invoiced"),
];
export const OUTSIDE_WORKSPACES: Record<string, string> = {
  changelog: "Help's What's new tab (PageTabs on /help)",
  "theme-editor": "Look & Text's Theme tab (PageTabs on /admin/copy), and Appearance",
  journal: "Audit's Financial Journal tab (PageTabs on /logs), and a bill's History link",
  "ai-cost": "Audit's AI Cost tab (PageTabs on /logs)",
  actions: "retired 2026-10-18; its buttons are on Inbox (email scans) and Tracking Sheets' Company tools (syncs); /actions redirects",
  onboarding: "a new hire's own paperwork, reached from the invite link and the field landing redirect on Today (src/app/page.tsx)",
  "time-off-admin": "a section of Payroll (/payroll?section=timeoff); /time-off/office redirects",
  "labor-import": "a section of Payroll (/payroll?section=labor); /labor-import redirects",
  clients: "Customers' All customers section (/leads?section=all), and a job's Record tab (/clients?jobId)",
  jobs: "a job's tab row (JobTabs) and the header search (JOB_PAGES)",
  "budget-import": "a job's tab row (JobTabs) and the header search (JOB_PAGES)",
  specs: "a job's tab row (JobTabs) and the header search (JOB_PAGES)",
  "house-manual": "a job's tab row (JobTabs) and the header search (JOB_PAGES)",
  unbilled: "a job's tab row (JobTabs) and the header search (JOB_PAGES)",
  chat: "menu footer (EXTRA_LINKS)",
  lopezrocks: "menu footer (EXTRA_LINKS) and the home page",
  rfis: "retired 2026-10-18 (owner); the page is deleted and /rfis redirects home. The view still gates /api/rfis and its stored rows",
  "labor-review": "folded into the Tracking Sheets job workbench's labor panel 2026-10-18; /labor-review redirects; the view still gates /api/labor-review and /api/labor-report",
  "needs-project": "a section of Inbox (/email?section=stuck); /needs-project redirects",
  "vendor-mail": "a section of Inbox (/email?section=mail); /vendor-mail redirects",
  "tracking-sheet": "Sheet sync settings, linked from Tracking Sheets' Company tools; Finalize is on each job since 2026-10-18",
  "bill-review": "a section of Checks (/invoice-review?section=flagged); /needs-review redirects",
  "taxable-lines": "a section of Checks (/invoice-review?section=taxable); /taxable-lines redirects",
};

/**
 * Pages that show no tab strip. The safety meeting is passed around the room
 * on an iPad; a row of other pages above the sign-in is a way to lose it.
 * Miles dropped its strip at the owner's ask (2026-10-30); the ☰ menu and the
 * bottom bar still reach Tools, Requisitions and Time Off.
 */
export const NO_STRIP = new Set(["safety-meeting", "mileage"]);

/** Workspaces that show no tab strip on any of their pages. Invoicing dropped
 * its strip at the owner's ask (2026-10-03); the ☰ menu still lists its pages. */
export const NO_STRIP_WORKSPACES = new Set(["close"]);

/** Workspaces the ☰ menu shows as ONE row, named for the workspace, opening its
 * first page — and the desktop sidebar shows with no second level. Invoicing went to a single row at the owner's ask (2026-10-13):
 * its pages are reached from Tracking Sheets and the header search. Employees and
 * Time have one page each, so a second level would only repeat it. */
export const MENU_SINGLE_WORKSPACES = new Set(["close"]);

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
  // Jobs took Incoming Bills' slot on 2026-10-03 (owner). Incoming Bills is
  // still in the ☰ menu and on the iPad rail. Time took My Work's slot, and
  // admin's Office slot went to Miles, on 2026-10-16 (owner): one bar for both.
  // Tools took Jobs' slot on 2026-10-29 (owner). Jobs is still in the ☰ menu
  // and on the iPad rail.
  office: [
    { kind: "today" },
    { kind: "workspace", id: "close" },
    { kind: "tab", view: "tools" },
    { kind: "tab", view: "mileage" },
    { kind: "tab", view: "employee-time" },
  ],
  admin: [
    { kind: "today" },
    { kind: "workspace", id: "close" },
    { kind: "tab", view: "tools" },
    { kind: "tab", view: "mileage" },
    { kind: "tab", view: "employee-time" },
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
  /** A single-page slot's whole workspace: it lights the slot when no slot
   *  covers the route exactly (office on /leads lights Jobs). */
  area?: string[];
  /** Rail only: the first item after the top group, drawn after a space. */
  gap?: boolean;
}

const TAB_BY_VIEW = new Map(WORKSPACES.flatMap((w) => w.tabs.map((t) => [t.view, t] as const)));

/** Where the device's pinned page is kept (a view id). Per device, like the old drawer's pins. */
export const BAR_PIN_KEY = "bar.pin";
/** Fired on `window` when the pin changes, so the bar updates without a reload. */
export const BAR_PIN_EVENT = "bar-pin";

/** Slots → items, skipping any this person cannot open. */
function resolveSlots(slots: BarSlot[], can: (view: string) => boolean): BarItem[] {
  const out: BarItem[] = [];
  for (const slot of slots) {
    if (slot.kind === "today") {
      out.push({ key: "today", label: TODAY.label, href: "/", view: "", covers: ["/"] });
    } else if (slot.kind === "tab") {
      const t = TAB_BY_VIEW.get(slot.view);
      if (t && can(t.view)) {
        const ws = WORKSPACES.find((w) => w.tabs.includes(t));
        const area = ws ? reachableTabs(ws, can).map((x) => x.href) : [];
        out.push({ key: t.view, label: t.label, href: t.href, view: t.view, covers: [t.href], area });
      }
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
  return out;
}

/** The pinned page as an item, or null when it is unknown, closed to them, or already a page slot. */
function pinItem(items: BarItem[], can: (view: string) => boolean, pin: string): BarItem | null {
  const t = pin ? TAB_BY_VIEW.get(pin) ?? EXTRA_LINKS.find((e) => e.view === pin) : undefined;
  if (!t || !can(t.view) || items.some((i) => i.view === t.view && !i.workspace)) return null;
  return { key: t.view, label: t.label, href: t.href, view: t.view, covers: [t.href] };
}

/**
 * The role's bar. `pin` is the page this person pinned from the menu: it takes
 * the LAST slot (or joins a bar with room), unless it is already on the bar or
 * they cannot open it.
 */
export function barFor(role: Role, can: (view: string) => boolean, pin = ""): BarItem[] {
  const out = resolveSlots(BARS[role] ?? BARS.field, can);
  const item = pinItem(out, can, pin);
  if (item) {
    if (out.length >= 5) out[out.length - 1] = item;
    else out.push(item);
  }
  return out;
}

/**
 * The top of the iPad rail and desktop sidebar, for the roles that run the
 * office — the owner's order (2026-10-16). Every other workspace follows after a
 * space. A role with no entry here keeps its bar as the top group.
 */
const DESK_TOP: BarSlot[] = [
  { kind: "today" },
  { kind: "workspace", id: "close" },
  { kind: "workspace", id: "employees" },
  { kind: "workspace", id: "clients" },
  // Vendors under Jobs at the owner's ask (2026-10-26).
  { kind: "tab", view: "vendors" },
  { kind: "workspace", id: "time" },
  // Tools on the rail too (owner, 2026-10-29), as on the phone bar.
  { kind: "tab", view: "tools" },
];
export const RAIL_TOP: Partial<Record<Role, BarSlot[]>> = { admin: DESK_TOP, office: DESK_TOP };

/**
 * The iPad rail and desktop sidebar: the top group (RAIL_TOP, else the bar),
 * the pinned page, then — after a space — every other workspace this person can
 * open. The rail has the height the bar lacks, so nothing is left for the menu.
 */
export function railFor(role: Role, can: (view: string) => boolean, pin = ""): BarItem[] {
  const top = RAIL_TOP[role];
  const out = top ? resolveSlots(top, can) : barFor(role, can, pin);
  const item = top ? pinItem(out, can, pin) : null;
  if (item && !out.some((i) => i.view === item.view)) out.push(item);
  const topCount = out.length;
  for (const ws of WORKSPACES) {
    const tabs = reachableTabs(ws, can);
    // Skip a workspace already on the rail, or one whose every page already is.
    if (!tabs.length || out.some((i) => i.workspace === ws.id)) continue;
    if (tabs.every((t) => out.some((i) => i.view === t.view && !i.workspace))) continue;
    out.push({ key: ws.id, label: ws.title, href: tabs[0].href, view: tabs[0].view, workspace: ws.id, covers: tabs.map((t) => t.href) });
  }
  if (out.length > topCount) out[topCount] = { ...out[topCount], gap: true };
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
  const hit = hits.find((i) => !i.workspace) ?? hits[0];
  if (hit) return hit.key;
  const inArea = items.find((i) => i.area?.some((href) => within(pathname, href)));
  if (inArea) return inArea.key;
  const parent = PARENT_WORKSPACE.find(([href]) => within(pathname, href))?.[1];
  return items.find((i) => i.workspace === parent)?.key ?? "";
}

/**
 * Pages on no workspace that still sit inside one: a job's own pages open from
 * a customer's record, and a bill opens from the month's close. Without this
 * the rail lit nothing on them, so the sidebar lost its place.
 */
const PARENT_WORKSPACE: [string, string][] = [
  ...JOB_PAGES.map((t) => [t.href, "clients"] as [string, string]),
  ["/bill", "close"],
  ["/add-bill", "close"],
];

/** How many links the phone bar's drawer holds: a 4 × 3 grid. */
export const DRAWER_SIZE = 12;

/**
 * The phone bar's drawer (owner, 2026-10-29): the pages the bar has no room
 * for, as a 4 × 3 grid of icons. First every workspace the rail lists that is
 * not already a bar slot; then single pages, in workspace order, that no slot
 * already opens. At most DRAWER_SIZE, and only what this person can open.
 */
export function drawerFor(role: Role, can: (view: string) => boolean, pin = ""): BarItem[] {
  const bar = barFor(role, can, pin);
  const taken = new Set(bar.map((i) => i.href));
  const out: BarItem[] = [];
  const add = (i: BarItem) => {
    if (out.length >= DRAWER_SIZE || taken.has(i.href)) return;
    taken.add(i.href);
    out.push({ ...i, gap: undefined });
  };
  const page = (t: WorkspaceTab): BarItem => ({ key: t.view, label: t.label, href: t.href, view: t.view, covers: [t.href] });
  for (const i of railFor(role, can, pin)) {
    if (bar.some((b) => b.key === i.key)) continue;
    // A workspace whose first page is a bar slot (Time, My Work) gives its
    // next page instead, under that page's own name.
    const ws = i.workspace ? WORKSPACES.find((w) => w.id === i.workspace) : undefined;
    const next = ws && taken.has(i.href) ? reachableTabs(ws, can).find((t) => !taken.has(t.href)) : undefined;
    add(next ? page(next) : i);
  }
  for (const ws of WORKSPACES) {
    for (const t of reachableTabs(ws, can)) add(page(t));
  }
  for (const t of EXTRA_LINKS) {
    if (can(t.view)) add(page(t));
  }
  return out;
}
