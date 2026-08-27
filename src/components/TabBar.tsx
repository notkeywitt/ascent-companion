"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";

/**
 * Bottom tab bar — the app's fast path between the handful of pages a person
 * actually opens all day.
 *
 * Note the history here: the app HAD tabs once, across the top of the header,
 * and they were retired. This is not that. Those tabs sat in the chrome furthest
 * from a thumb and competed with the job picker for the same strip; these are
 * docked at the bottom, thumb-height, and carry at most four destinations. Home
 * stays the full launcher — the tab bar is a shortcut to the busiest pages, not
 * a replacement for the launcher's twenty-odd.
 *
 * Every tab is gated through the SAME view ids as the launcher, so a field user
 * never sees a Tracking Sheets tab that the middleware would only bounce them off.
 * The set adapts per role rather than being fixed: TAB_CANDIDATES is scanned in
 * order and the first three the user can reach are shown after Home.
 */

type Tab = { label: string; href: string; view: string; Icon: () => React.ReactNode };

/* Flat 2px line icons on a 24×24 grid, matching the launcher's set. */
const IconBase = ({ children }: { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-[19px] w-[19px]"
    aria-hidden
  >
    {children}
  </svg>
);

const HomeIcon = () => (
  <IconBase>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </IconBase>
);
const BanknoteIcon = () => (
  <IconBase>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </IconBase>
);
const ClockIcon = () => (
  <IconBase>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </IconBase>
);
const RouteIcon = () => (
  <IconBase>
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </IconBase>
);
const WrenchIcon = () => (
  <IconBase>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </IconBase>
);
const ClipboardIcon = () => (
  <IconBase>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    <path d="M9 12h6M9 16h4" />
  </IconBase>
);

/**
 * Candidates in priority order — the first three the signed-in user can reach
 * fill the three slots after Home. Reorder this array to change the tab bar;
 * nothing else needs touching.
 *
 * As it stands: office/admin get Tracking Sheets · Time · Miles, and a field or lead
 * user (who has no `recode` view) gets Time · Miles · Tools.
 */
const TAB_CANDIDATES: Tab[] = [
  { label: "Tracking Sheets", href: "/trackingsheet", view: "recode", Icon: BanknoteIcon },
  { label: "Time", href: "/employee-time", view: "employee-time", Icon: ClockIcon },
  { label: "Miles", href: "/mileage-tracker", view: "mileage", Icon: RouteIcon },
  { label: "Tools", href: "/tools", view: "tools", Icon: WrenchIcon },
  { label: "Reqs", href: "/requisitions", view: "requisitions", Icon: ClipboardIcon },
];

const HOME_TAB: Tab = { label: "Home", href: "/", view: "", Icon: HomeIcon };

export function TabBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const access = useAccess();

  // The bar is chrome for the signed-in app; these two pages have none.
  if (pathname === "/login" || pathname === "/privacy") return null;

  const tabs = [HOME_TAB, ...TAB_CANDIDATES.filter((t) => access.can(t.view)).slice(0, 3)];
  // One tab is just Home — a bar with a single destination is decoration, and it
  // would cost every page 56px to say nothing.
  if (tabs.length < 2) return null;

  // Carry the selected job across, exactly as the launcher does, so hopping to
  // Tracking Sheets from a job keeps that job in context.
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-cream/95 backdrop-blur dark:bg-ink/95 print:hidden"
      style={{
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {tabs.map((t) => {
        // Home is only "current" on exactly "/" — every other route is a page
        // reached FROM it, and a permanently-lit Home tab tells you nothing.
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href + qs}
            aria-current={active ? "page" : undefined}
            // The job picker and the bill editor both guard unsaved work; a tab
            // is a navigation like any other, so it asks the same question.
            onClick={(e) => {
              if (!confirmLeaveIfDirty()) e.preventDefault();
            }}
            // Two kinds of tap feedback, because they answer different
            // questions. `active:` is the PRESS — it paints the instant a
            // finger lands, so the tap never feels ignored, and it needs no
            // round trip. The overlay below is the WAIT — it appears only while
            // that link's navigation is actually in flight, which on a slow
            // connection is the difference between "did that register?" and
            // "it's working on it".
            className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold transition active:bg-accent/15 ${
              active
                ? "text-accent dark:text-accent-soft"
                : "text-neutral-500 hover:text-accent dark:text-neutral-400"
            }`}
          >
            {/* The active mark is a short ochre rule above the icon — the same
                rule <SectionHeading> uses, so "you are here" is drawn in the
                app's one ornament rather than a second visual language. */}
            <span
              aria-hidden
              className={`h-0.5 w-4 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
            />
            <t.Icon />
            {t.label}
            {/* Same tap→loading affordance the launcher rows and quick tiles
                use, so a tab behaves like every other link in the app. */}
            <LinkPendingOverlay spinnerClassName="h-5 w-5" />
          </Link>
        );
      })}
    </nav>
  );
}
