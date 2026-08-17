"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  CountBadge,
  ListCard,
  ListRow,
  SectionHeading,
  btn,
  inputCls,
} from "@/components/ui";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { AdminActionBar } from "@/components/AdminActionBar";
import { StuckVendorBanner } from "@/components/StuckVendors";
import { NeedsProjectBanner, useNeedsProjectCount } from "@/components/NeedsProject";

/**
 * The Assistant's front page — the launcher, and still the only place EVERY
 * gateable view is reachable from (the tab bar carries at most three shortcuts).
 * A new view must appear in AREAS or QUICK here, or it becomes dead.
 *
 * The areas used to be accordions, all rolled shut. That cost three taps to
 * reach a page from cold and hid the app's own contents from someone who didn't
 * already know what was inside. They are open lists now: each area shows its
 * first few destinations with a "show the rest" control, and the search box
 * above covers all of them at once — so finding a page is one tap or one word,
 * never a hunt through four closed drawers.
 */

/* ------------------------------------------------------------------- icons */
/* Flat, monochrome line icons (one color via currentColor — the brand accent).
   Uniform 24×24 grid, 2px stroke, so the marks read as one set. */

function IconBase({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

/** Wrench — Tools. */
const WrenchIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </IconBase>
);

/** Clock — Time (employee time). */
const ClockIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </IconBase>
);

/** Clipboard — Requisitions. */
const ClipboardIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    <path d="M9 12h6M9 16h4" />
  </IconBase>
);

/** Calendar — Time Off. */
const CalendarIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </IconBase>
);

/** Route — Miles (mileage tracker). */
const RouteIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </IconBase>
);

/** Magnifier — the search field. */
const SearchIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </IconBase>
);

/* -------------------------------------------------------------------- data */

// `view` is the gate id from lib/views — entries the signed-in user can't see
// are filtered out (see the filtering in Home below).
type Dest = { label: string; href: string; desc: string; view: string };
// `id` is the STABLE handle — React keys, expand state, and the copy registry
// key all hang off it, so the editable `title` can be reworded from
// Admin → Page Text without resetting anyone's expanded sections.
type Area = { id: string; title: string; blurb: string; dests: Dest[] };
type Quick = { label: string; full: string; href: string; Icon: (p: IconProps) => ReactNode; view: string };

// The four one-tap destinations every employee gets, at the top of the launcher.
// `label` is the short form the 4-across rail can actually fit; `full` is what
// a screen reader and the tooltip say.
const QUICK: Quick[] = [
  { label: "Miles", full: "Mileage tracker", href: "/mileage-tracker", Icon: RouteIcon, view: "mileage" },
  { label: "Time", full: "Employee time", href: "/employee-time", Icon: ClockIcon, view: "employee-time" },
  { label: "Tools", full: "Tools", href: "/tools", Icon: WrenchIcon, view: "tools" },
  { label: "Reqs", full: "Requisitions", href: "/requisitions", Icon: ClipboardIcon, view: "requisitions" },
];

// How many rows an area shows before "show the rest" — enough that the short
// areas are complete at a glance, few enough that Utilities' nine don't bury
// everything under them.
const PREVIEW_ROWS = 3;

const AREAS: Area[] = [
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
      { label: "Vendors", href: "/vendors", desc: "Search a vendor's bills — job, date, amount", view: "vendors" },
      { label: "Expenditure History", href: "/expenditure-history", desc: "The sheet's archive, including the years before JobTread", view: "expenditure-history" },
    ],
  },
  {
    id: "hr",
    title: "HR",
    blurb: "Roster, labor, time off, and safety.",
    dests: [
      { label: "Leads", href: "/leads", desc: "New leads, who's overdue, who's gone quiet", view: "leads" },
      { label: "Employees", href: "/employees", desc: "The Project Database roster", view: "employees" },
      { label: "Labor Import", href: "/labor-import", desc: "QuickBooks labor → JobTread CSV", view: "labor-import" },
      { label: "Labor Rates", href: "/labor-rates", desc: "Per-project pay rates & who has them", view: "labor-rates" },
      { label: "Time Off", href: "/time-off", desc: "Requests, balances & accrual policy", view: "time-off" },
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
      { label: "Course", href: "/course", desc: "Learn how this app works, one segment at a time", view: "course" },
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
    ],
  },
];

function Home() {
  const search = useSearchParams();
  const access = useAccess();
  // Office-edited wording (Admin → Page Text); falls back to the English below.
  const c = useCopy();
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  const [query, setQuery] = useState("");
  // Which areas the user has expanded past their preview rows.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Show only what this user can access; hide an area whose links all filter out.
  //
  // Every user-visible string is resolved through `c()` HERE, at the one place
  // the lists are built, so search, the rows and the headings all read the same
  // (possibly office-edited) wording — see src/lib/copy.ts. The `|| a.title`
  // fallbacks mean a destination added to AREAS but not yet registered renders
  // its inline English instead of going blank.
  const quick = QUICK.filter((q) => access.can(q.view)).map((q) => ({
    ...q,
    label: c(`home.quick.${q.view}.label`) || q.label,
    full: c(`home.quick.${q.view}.full`) || q.full,
  }));
  const areas = useMemo(
    () =>
      AREAS.map((a) => ({
        ...a,
        title: c(`home.area.${a.id}.title`) || a.title,
        blurb: c(`home.area.${a.id}.blurb`) || a.blurb,
        dests: a.dests
          .filter((d) => access.can(d.view))
          .map((d) => ({
            ...d,
            label: c(`home.dest.${d.view}.label`) || d.label,
            desc: c(`home.dest.${d.view}.desc`) || d.desc,
          })),
      })).filter((a) => a.dests.length > 0),
    [access, c],
  );

  // Every employee can request time off. Office/admin reach it from the HR area;
  // for anyone else (field/lead) it isn't in a visible area, so surface it as its
  // own button — that way it's never stranded.
  const timeOffInArea = areas.some((a) => a.dests.some((d) => d.view === "time-off"));
  const showTimeOff = access.can("time-off") && !timeOffInArea;

  // Queue counts, keyed by view id. Add a future queue here and both the area
  // heading and its row pick it up with no further plumbing.
  const needsProject = useNeedsProjectCount();
  const badges: Record<string, number> =
    needsProject.count > 0 ? { "needs-project": needsProject.count } : {};

  // Search runs across every area at once and matches the description as well as
  // the name — "who can sign in" finds Admin, which a name-only match wouldn't.
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return areas
      .flatMap((a) => a.dests.map((d) => ({ ...d, area: a.title })))
      .filter((d) => `${d.label} ${d.desc} ${d.area}`.toLowerCase().includes(q));
  }, [q, areas]);

  // The vendor list, fetched once off the same shared cache every other page
  // reading /api/vendors uses — lets the search box surface a vendor by name
  // (not just the "Vendors" page entry above) with zero added network cost.
  const canSeeVendors = access.can("vendors");
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!canSeeVendors) return;
    let alive = true;
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => alive && setVendors(Array.isArray(j.vendors) ? j.vendors : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canSeeVendors]);
  const vendorMatches = useMemo(() => {
    if (!q || !canSeeVendors) return [];
    return vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 6);
  }, [q, vendors, canSeeVendors]);
  // A query that's purely digits reads as a bill number — offer the org-wide
  // lookup as one tappable row rather than firing it on every keystroke.
  const billNumberQuery = canSeeVendors && /^\d+$/.test(query.trim()) ? query.trim() : null;

  const pageCount = areas.reduce((n, a) => n + a.dests.length, 0);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-5">
      {/* No page title here on purpose: the logo in the header already says
          where you are, and an <h1>Home</h1> plus its description cost the top
          fifth of a phone screen to repeat it. */}

      {/* Bills that imported but couldn't push because their vendor isn't in
          JobTread. Self-hiding when there are none; gates itself on `email`. */}
      <StuckVendorBanner />

      {/* Ingested bills whose job couldn't be resolved (Sunset "Sold-To" names a
          customer with more than one job). Self-hiding when the queue is empty. */}
      <NeedsProjectBanner state={needsProject} />

      {pageCount > 4 && (
        <div className="relative mb-5">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          >
            <SearchIcon className="h-[17px] w-[17px]" />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${pageCount} pages`}
            aria-label="Search pages"
            className={`${inputCls} h-12 pl-10`}
          />
        </div>
      )}

      {/* Quick launch — the one-tap destinations every employee gets. A 4-across
          rail rather than the old 2×2 of 92px boxes: the same four taps in half
          the height, which is what lets the areas below start above the fold. */}
      {!q && (quick.length > 0 || showTimeOff) && (
        <div className="mb-6 space-y-3">
          {quick.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {quick.map((qk) => (
                <Link
                  key={qk.href}
                  href={qk.href + qs}
                  title={qk.full}
                  aria-label={qk.full}
                  className="relative flex flex-col items-center gap-2 rounded-xl border border-line bg-white p-3 text-center transition hover:border-accent hover:bg-accent/5 active:bg-accent/10 dark:bg-ink-raised dark:hover:bg-white/5"
                >
                  <span
                    aria-hidden
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft"
                  >
                    <qk.Icon className="h-5 w-5" />
                  </span>
                  <span className="text-[11.5px] font-bold tracking-tight">{qk.label}</span>
                  <LinkPendingOverlay spinnerClassName="h-5 w-5" />
                </Link>
              ))}
            </div>
          )}
          {showTimeOff && (
            <ListCard>
              <ListRow
                href={"/time-off" + qs}
                label="Time Off"
                desc="Request time off & see your balance"
                trailing={
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft"
                  >
                    <CalendarIcon className="h-5 w-5" />
                  </span>
                }
              />
            </ListCard>
          )}
        </div>
      )}

      {/* Search results replace the areas while there's a query — showing both
          would make the page longer exactly when someone is trying to shorten it. */}
      {q ? (
        <div className="space-y-2">
          <SectionHeading trailing={<span className="text-[11px] text-neutral-500">{matches.length}</span>}>
            {matches.length === 1 ? "1 match" : `${matches.length} matches`}
          </SectionHeading>
          {matches.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-neutral-500">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <ListCard>
              {matches.map((d) => (
                <ListRow
                  key={d.href}
                  href={d.href + qs}
                  label={d.label}
                  desc={`${d.area} · ${d.desc}`}
                  badge={(badges[d.view] ?? 0) > 0 ? <CountBadge n={badges[d.view]} /> : undefined}
                />
              ))}
            </ListCard>
          )}

          {/* Vendor name matches — separate from the page-name matches above,
              so "A1 Septic" finds the vendor itself, not just the Vendors
              page. Still client-side against the cached vendor list; only
              the number lookup below ever hits the network from this box. */}
          {vendorMatches.length > 0 && (
            <div className="space-y-2 pt-2">
              <SectionHeading>Vendors</SectionHeading>
              <ListCard>
                {vendorMatches.map((v) => (
                  <ListRow
                    key={v.id}
                    href={`/vendors?accountId=${encodeURIComponent(v.id)}`}
                    label={v.name}
                    desc="See their bills — job, date, amount"
                  />
                ))}
              </ListCard>
            </div>
          )}
          {billNumberQuery && (
            <div className="space-y-2 pt-2">
              <SectionHeading>Bill lookup</SectionHeading>
              <ListCard>
                <ListRow
                  href={`/vendors?number=${billNumberQuery}`}
                  label={`Look up bill #${billNumberQuery}`}
                  desc="Org-wide — bill numbers repeat across vendors"
                />
              </ListCard>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {areas.map((area) => {
            const isExpanded = !!expanded[area.id];
            const hidden = Math.max(0, area.dests.length - PREVIEW_ROWS);
            const shown = isExpanded ? area.dests : area.dests.slice(0, PREVIEW_ROWS);
            // Work queued behind the fold still shows on the heading, so a
            // collapsed tail never hides the one row that needs attention.
            const hiddenCount = area.dests
              .slice(shown.length)
              .reduce((n, d) => n + (badges[d.view] ?? 0), 0);
            return (
              <section key={area.id} className="space-y-2">
                <SectionHeading
                  trailing={
                    <span className="flex items-center gap-2">
                      {hiddenCount > 0 && <CountBadge n={hiddenCount} />}
                      <span className="text-[11px] tabular-nums text-neutral-500">
                        {area.dests.length}
                      </span>
                    </span>
                  }
                >
                  {area.title}
                </SectionHeading>
                <ListCard>
                  {shown.map((d) => (
                    <ListRow
                      key={d.href}
                      href={d.href + qs}
                      label={d.label}
                      desc={d.desc}
                      badge={(badges[d.view] ?? 0) > 0 ? <CountBadge n={badges[d.view]} /> : undefined}
                    />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded((e) => ({ ...e, [area.id]: !isExpanded }))}
                      aria-expanded={isExpanded}
                      className="min-h-11 w-full px-3 py-2.5 text-left text-[12.5px] font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
                    >
                      {isExpanded ? "Show fewer" : `Show ${hidden} more in ${area.title}`}
                    </button>
                  )}
                </ListCard>
              </section>
            );
          })}
        </div>
      )}

      {/* Admin-only: quick-jump links to the busiest queues plus buttons that
          run a script job without leaving the launcher. Sits at the bottom, out
          of the field/office user's way. Gated on the same `actions` view as the
          /actions page and the /api/actions route. */}
      {!q && access.can("actions") && (
        <div className="mt-6">
          <AdminActionBar jobQs={qs} />
        </div>
      )}

      {/* No views at all — don't leave a blank page. This happens when the
          session carries no identity/role (e.g. signed in with the temporary
          shared password rather than Google). Offer a way back to Google. */}
      {quick.length === 0 && areas.length === 0 && !showTimeOff && (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center dark:border-neutral-700">
          <p className="text-sm font-semibold">No views are available for your account yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs text-neutral-500">
            If you signed in with the temporary password, sign in with Google to load your
            access. Otherwise, ask an admin to grant you access.
          </p>
          <Link href="/login" className={btn("primary", "md", "mt-4")}>
            Sign in with Google
          </Link>
        </div>
      )}

      {/* Account / sign out. Access (which menus you see) is baked in at
          sign-in, so signing out and back in is how you pick up a changed
          role — e.g. if the launcher is missing sections you expect, your
          session may still be on the default "field" role. */}
      <div className="mt-8 border-t border-line pt-5 text-center">
        <p className="text-xs text-neutral-500">
          Signed in — access level: <span className="font-semibold">{access.role}</span>
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={btn("secondary", "md", "mt-3")}
        >
          Sign out
        </button>
        <p className="mx-auto mt-2 max-w-sm text-xs text-neutral-500">
          Missing menus you expect? Sign out and back in to refresh your access.
        </p>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Home />
    </Suspense>
  );
}
