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
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { AdminActionBar } from "@/components/AdminActionBar";
import { StuckVendorBanner } from "@/components/StuckVendors";
import { NeedsProjectBanner, useNeedsProjectCount } from "@/components/NeedsProject";

/**
 * The Assistant's front page — the launcher, and still the only place EVERY
 * gateable view is reachable from (the tab bar carries at most three shortcuts).
 * A new view must appear in AREAS here, or it becomes dead.
 *
 * There used to be a second, separate thing at the top: a 4-across rail of
 * "quick" tiles (Miles · Time · Tools · Reqs). But the permanent bottom tab bar
 * already carries those same everyday shortcuts, so the rail was repeating the
 * chrome directly above it — two rows of the same buttons before the launcher
 * proper even began. It's gone. Those five personal destinations now live in a
 * "My Work" area at the top of the list, so the whole page is one pattern —
 * search over open, hairline-divided area lists — and nothing is said twice.
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
// `preview` optionally overrides PREVIEW_ROWS for one area (My Work shows all of
// its short list rather than hiding the daily tools behind "show more").
type Area = { id: string; title: string; blurb: string; dests: Dest[]; preview?: number };

// How many rows an area shows before "show the rest" — enough that the short
// areas are complete at a glance, few enough that Utilities' nine don't bury
// everything under them.
const PREVIEW_ROWS = 3;

const AREAS: Area[] = [
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
            const previewRows = area.preview ?? PREVIEW_ROWS;
            const isExpanded = !!expanded[area.id];
            const hidden = Math.max(0, area.dests.length - previewRows);
            const shown = isExpanded ? area.dests : area.dests.slice(0, previewRows);
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
      {areas.length === 0 && (
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
