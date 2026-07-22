"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui";

/**
 * The Assistant's front page — the launcher the app opens to.
 *
 * Four areas (Financials, Tools, Safety, Utilities) group every page the tab
 * bar reaches into big, thumb-sized rows. It's an entry point, not a new tab:
 * the tab bar layout is unchanged and each row deep-links to the same route its
 * tab does. The selected job (if any) carries through on the query string, so
 * landing on a job's Coding Review / Invoicing keeps that job in context.
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

/** Hard hat — Safety. */
const HardHatIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" />
    <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
    <path d="M14 6a6 6 0 0 1 6 6v3" />
    <path d="M4 15v-3a6 6 0 0 1 6-6" />
  </IconBase>
);

/** Gear — Utilities. */
const GearIcon = ({ className }: IconProps) => (
  <IconBase className={className}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </IconBase>
);

/* -------------------------------------------------------------------- data */

type Dest = { label: string; href: string; desc: string };
type Area = { title: string; Icon: (p: IconProps) => ReactNode; blurb: string; dests: Dest[] };

const AREAS: Area[] = [
  {
    title: "Financials",
    Icon: BanknoteIcon,
    blurb: "Bill coding, unbilled expenses, and monthly invoicing.",
    dests: [
      { label: "Coding Review", href: "/coding", desc: "Draft bills waiting to be coded" },
      { label: "Invoicing", href: "/stage", desc: "Stage the month's customer invoice" },
      { label: "Unbilled", href: "/unbilled", desc: "Uninvoiced expenses by cost code" },
      { label: "Email Invoices", href: "/email", desc: "Log invoices from the office inbox" },
      { label: "Needs Project", href: "/needs-project", desc: "Ingested bills with no job yet" },
    ],
  },
  {
    title: "Tools",
    Icon: WrenchIcon,
    blurb: "The field tool inventory.",
    dests: [
      { label: "Tool Inventory", href: "/tools", desc: "Search, edit, or scan a tool's QR" },
    ],
  },
  {
    title: "Safety",
    Icon: HardHatIcon,
    blurb: "Job-site safety records.",
    dests: [
      { label: "Safety Meeting", href: "/safety-meeting", desc: "Pass the iPad and collect sign-ins" },
      { label: "Mileage", href: "/mileage-tracker", desc: "Log business miles, one tap each way" },
    ],
  },
  {
    title: "Utilities",
    Icon: GearIcon,
    blurb: "Assistant, records, imports, and system tools.",
    dests: [
      { label: "Assistant", href: "/chat", desc: "Ask about a job's bills or budget" },
      { label: "RFIs", href: "/rfis", desc: "View and create a job's RFIs" },
      { label: "Employees", href: "/employees", desc: "The Project Database roster" },
      { label: "Labor Import", href: "/labor-import", desc: "QuickBooks labor → JobTread CSV" },
      { label: "Actions", href: "/actions", desc: "Run a script job on demand" },
      { label: "Requests", href: "/requests", desc: "Ask for fixes and new features" },
      { label: "Admin", href: "/admin", desc: "Who can sign in" },
      { label: "Logs", href: "/logs", desc: "The automation audit trail" },
    ],
  },
];

function Home() {
  const search = useSearchParams();
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Home"
        description="Financials, tools, safety, and utilities — jump to what you need."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {AREAS.map((area) => (
          <section
            key={area.title}
            className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-700/60 dark:bg-ink-raised"
          >
            <div className="mb-3 flex items-start gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft"
              >
                <area.Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold tracking-tight">{area.title}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">{area.blurb}</p>
              </div>
            </div>

            <ul className="space-y-1.5">
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
          </section>
        ))}
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
