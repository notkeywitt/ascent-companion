"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui";

/**
 * The Companion's front page — the launcher the app opens to.
 *
 * Four areas (Financials, Tools, Safety, Utilities) group every page the tab
 * bar reaches into big, thumb-sized rows. It's an entry point, not a new tab:
 * the tab bar layout is unchanged and each row deep-links to the same route its
 * tab does. The selected job (if any) carries through on the query string, so
 * landing on a job's Coding Review / Invoicing keeps that job in context.
 */

type Dest = { label: string; href: string; desc: string };
type Area = { title: string; icon: string; blurb: string; dests: Dest[] };

const AREAS: Area[] = [
  {
    title: "Financials",
    icon: "💵",
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
    icon: "🔧",
    blurb: "The field tool inventory.",
    dests: [
      { label: "Tool Inventory", href: "/tools", desc: "Search, edit, or scan a tool's QR" },
    ],
  },
  {
    title: "Safety",
    icon: "🦺",
    blurb: "Job-site safety records.",
    dests: [
      { label: "Safety Meeting", href: "/safety-meeting", desc: "Pass the iPad and collect sign-ins" },
    ],
  },
  {
    title: "Utilities",
    icon: "🧰",
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
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xl dark:bg-accent/15"
              >
                {area.icon}
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
