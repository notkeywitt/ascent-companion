"use client";

import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { PageHeader, btn } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";

/**
 * The Assistant's front page — the launcher the app opens to.
 *
 * Two areas (Financials, Utilities) group every page the tab bar reaches into
 * collapsible menus that stay rolled up until tapped. Above them, three quick
 * buttons (Mileage, Time, Tools) put the most-used destinations one tap away.
 * It's an entry point, not a new tab: the tab bar layout is unchanged and each
 * row deep-links to the same route its tab does. The selected job (if any)
 * carries through on the query string, so landing on a job's Coding Review /
 * Invoicing keeps that job in context.
 */

/* ------------------------------------------------------------------- icons */
/* Flat, monochrome line icons (one color via currentColor — the brand accent).
   Uniform 24×24 grid, 2px stroke, so the four area marks read as one set. */

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

/** Banknote — Financials. */
const BanknoteIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </IconBase>
);

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

/** Chevron — the roll-up indicator on each collapsible menu. */
const ChevronDownIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <path d="m6 9 6 6 6-6" />
  </IconBase>
);

/** Gear — Utilities. */
const GearIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
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

/* -------------------------------------------------------------------- data */

// `view` is the gate id from lib/views — entries the signed-in user can't see
// are filtered out (see the filtering in Home below).
type Dest = { label: string; href: string; desc: string; view: string };
type Area = { title: string; Icon: (p: IconProps) => ReactNode; blurb: string; dests: Dest[] };
type Quick = { label: string; href: string; Icon: (p: IconProps) => ReactNode; view: string };

// The three most-used destinations, one tap from the top of the launcher.
const QUICK: Quick[] = [
  { label: "Mileage", href: "/mileage-tracker", Icon: RouteIcon, view: "mileage" },
  { label: "Time", href: "/employee-time", Icon: ClockIcon, view: "employee-time" },
  { label: "Tools", href: "/tools", Icon: WrenchIcon, view: "tools" },
];

const AREAS: Area[] = [
  {
    title: "Financials",
    Icon: BanknoteIcon,
    blurb: "Bill coding, unbilled expenses, and monthly invoicing.",
    dests: [
      { label: "Coding Review", href: "/coding", desc: "Draft bills waiting to be coded", view: "coding" },
      { label: "Invoicing", href: "/stage", desc: "Stage the month's customer invoice", view: "stage" },
      { label: "Unbilled", href: "/unbilled", desc: "Uninvoiced expenses by cost code", view: "unbilled" },
      { label: "Email Invoices", href: "/email", desc: "Log invoices from the office inbox", view: "email" },
      { label: "Needs Project", href: "/needs-project", desc: "Ingested bills with no job yet", view: "needs-project" },
    ],
  },
  {
    title: "Utilities",
    Icon: GearIcon,
    blurb: "Assistant, safety, records, imports, and system tools.",
    dests: [
      { label: "Assistant", href: "/chat", desc: "Ask about a job's bills or budget", view: "chat" },
      { label: "Safety Meeting", href: "/safety-meeting", desc: "Pass the iPad and collect sign-ins", view: "safety-meeting" },
      { label: "RFIs", href: "/rfis", desc: "View and create a job's RFIs", view: "rfis" },
      { label: "Employees", href: "/employees", desc: "The Project Database roster", view: "employees" },
      { label: "Labor Import", href: "/labor-import", desc: "QuickBooks labor → JobTread CSV", view: "labor-import" },
      { label: "Actions", href: "/actions", desc: "Run a script job on demand", view: "actions" },
      { label: "Requests", href: "/requests", desc: "Ask for fixes and new features", view: "requests" },
      { label: "Admin", href: "/admin", desc: "Who can sign in", view: "admin" },
      { label: "Logs", href: "/logs", desc: "The automation audit trail", view: "logs" },
    ],
  },
];

function Home() {
  const search = useSearchParams();
  const access = useAccess();
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  // Each menu stays rolled up until tapped; track which titles are open.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (title: string) =>
    setOpen((o) => ({ ...o, [title]: !o[title] }));

  // Show only what this user can access; hide an area whose links all filter out.
  const quick = QUICK.filter((q) => access.can(q.view));
  const areas = AREAS.map((a) => ({
    ...a,
    dests: a.dests.filter((d) => access.can(d.view)),
  })).filter((a) => a.dests.length > 0);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Home"
        description="Jump to what you need — tap a menu to roll it open."
      />

      {/* Quick launch — the three most-used destinations as big, thumb-sized
          buttons above the full launcher grid. */}
      {quick.length > 0 && (
      <div className="mb-6 grid grid-cols-3 gap-3">
        {quick.map((q) => (
          <Link
            key={q.href}
            href={q.href + qs}
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white p-3 text-center transition hover:border-accent hover:bg-accent/5 dark:border-neutral-700/60 dark:bg-ink-raised dark:hover:bg-white/5"
          >
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft"
            >
              <q.Icon className="h-6 w-6" />
            </span>
            <span className="text-sm font-bold tracking-tight">{q.label}</span>
          </Link>
        ))}
      </div>
      )}

      <div className="space-y-3">
        {areas.map((area) => {
          const isOpen = !!open[area.title];
          return (
            <section
              key={area.title}
              className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700/60 dark:bg-ink-raised"
            >
              <button
                type="button"
                onClick={() => toggle(area.title)}
                aria-expanded={isOpen}
                className="flex min-h-[64px] w-full items-center gap-3 p-4 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
              >
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft"
                >
                  <area.Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold tracking-tight">{area.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">{area.blurb}</span>
                </span>
                <span
                  aria-hidden
                  className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${isOpen ? "rotate-180" : ""}`}
                >
                  <ChevronDownIcon className="h-5 w-5" />
                </span>
              </button>

              {isOpen && (
                <ul className="space-y-1.5 px-4 pb-4">
                  {area.dests.map((d) => (
                    <li key={d.href}>
                      <Link
                        href={d.href + qs}
                        className="group flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2.5 transition hover:border-accent hover:bg-accent/5 dark:hover:bg-white/5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{d.label}</span>
                          <span className="block truncate text-xs text-neutral-500">{d.desc}</span>
                        </span>
                        <span
                          aria-hidden
                          className="shrink-0 text-neutral-300 transition group-hover:text-accent dark:text-neutral-600 dark:group-hover:text-accent-soft"
                        >
                          ›
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* No views at all — don't leave a blank page. This happens when the
          session carries no identity/role (e.g. signed in with the temporary
          shared password rather than Google). Offer a way back to Google. */}
      {quick.length === 0 && areas.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-8 text-center dark:border-neutral-700">
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
