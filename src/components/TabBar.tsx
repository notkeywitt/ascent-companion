"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { carryJobAndMonth } from "@/lib/urlParam";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";
import {
  BAR_PIN_EVENT,
  BAR_PIN_KEY,
  WORKSPACES,
  activeBarKey,
  barFor,
  railFor,
  reachableTabs,
  type BarItem,
} from "@/lib/workspaces";

/**
 * Bottom tab bar — up to five slots, docked at thumb height.
 *
 * The slots come from BARS in src/lib/workspaces.ts, per role: Today, a whole
 * WORKSPACE (Invoicing goes to its first tab the person can open), or one
 * page (Miles). Every slot is gated on the same view ids as the middleware, so
 * a slot someone cannot open is simply absent. EVERY role gets a bar, leads
 * included (owner, 2026-09-29): it is the way home from any page, and the
 * header's ☰ menu carries everything else.
 *
 * PINNED: a person can pin one page from the ☰ menu (per device). It takes the
 * bar's last slot; see `barFor`.
 *
 * FROM `pad` UP IT IS A RAIL down the left edge (owner, 2026-09-29): the bar's
 * slots, then every other workspace — the height the phone bar lacks. From 2xl
 * (1536px) it widens into a sidebar that also lists the current workspace's
 * pages, and the tab strip under the header steps aside. Same slots, same
 * gates; the rail's width is --rail-w in globals.css.
 */

/* Flat 2px line icons on a 24×24 grid. */
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
const ComputerIcon = () => (
  <IconBase>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </IconBase>
);
const InboxIcon = () => (
  <IconBase>
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M5.5 5h13L21 13v6H3v-6z" />
  </IconBase>
);
const BriefcaseIcon = () => (
  <IconBase>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
  </IconBase>
);
const CalendarIcon = () => (
  <IconBase>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </IconBase>
);
const UsersIcon = () => (
  <IconBase>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6.5 6.5 0 0 0-2.5-5.1" />
  </IconBase>
);
const BadgeIcon = () => (
  <IconBase>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M8 17a4 4 0 0 1 8 0" />
  </IconBase>
);
const SearchIcon = () => (
  <IconBase>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </IconBase>
);
const HelpIcon = () => (
  <IconBase>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.8M12 17h.01" />
  </IconBase>
);
const ShieldIcon = () => (
  <IconBase>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.1 8 9 4.6-.9 8-4.5 8-9V6z" />
  </IconBase>
);
/** A pinned page, which has no icon of its own. */
const PinIcon = () => (
  <IconBase>
    <path d="M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3z" />
  </IconBase>
);
const ClipboardIcon = () => (
  <IconBase>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    <path d="M9 12h6M9 16h4" />
  </IconBase>
);

/** A claw hammer — the Jobs page. */
const HammerIcon = () => (
  <IconBase>
    <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
    <path d="m18 15 4-4" />
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-1.26-1.26a6 6 0 0 0-4.202-1.756L9 4l.92.82A6.18 6.18 0 0 1 12 9.42V11l2 2h2.172a2 2 0 0 1 1.414.586L19.5 15.5" />
  </IconBase>
);

/** A slot's icon, by its key (a workspace id, a view id, or "today"). */
const ICONS: Record<string, () => React.ReactNode> = {
  today: HomeIcon,
  close: BanknoteIcon,
  incoming: InboxIcon,
  office: ComputerIcon,
  mywork: BriefcaseIcon,
  clients: UsersIcon,
  people: BadgeIcon,
  search: SearchIcon,
  help: HelpIcon,
  admin: ShieldIcon,
  "employee-time": ClockIcon,
  mileage: RouteIcon,
  tools: WrenchIcon,
  requisitions: ClipboardIcon,
  "job-board": HammerIcon,
  "time-off": CalendarIcon,
};

export function TabBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const access = useAccess();
  const c = useCopy();

  // The device's pinned page. Read in an effect, not at render: the bar is
  // server-rendered, and a first render that read storage would not match it.
  const [pin, setPin] = useState("");
  useEffect(() => {
    const read = () => {
      try {
        setPin(localStorage.getItem(BAR_PIN_KEY) ?? "");
      } catch {
        /* storage blocked — no pin */
      }
    };
    read();
    window.addEventListener(BAR_PIN_EVENT, read);
    return () => window.removeEventListener(BAR_PIN_EVENT, read);
  }, []);

  // The bar is chrome for the signed-in app; these two pages have none.
  if (pathname === "/login" || pathname === "/privacy") return null;

  const items = barFor(access.role, access.can, pin);
  const rail = railFor(access.role, access.can, pin);
  // One slot is decoration, and it would cost every page 56px to say nothing.
  if (items.length < 2) return null;
  const active = activeBarKey(items, pathname);
  const railActive = activeBarKey(rail, pathname);

  // Carry the selected job across, so hopping to a page from a job keeps it.
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  // A single-page slot takes the short bar word the office can reword; a
  // workspace or Today says its own name.
  const labelOf = (t: BarItem) => (!t.workspace && t.view ? c(`home.quick.${t.view}.label`) || t.label : t.label);
  // The job picker and the bill editor both guard unsaved work; a slot is a
  // navigation like any other, so it asks the same question.
  const guard = (e: React.MouseEvent) => {
    if (!confirmLeaveIfDirty()) e.preventDefault();
  };

  return (
    <>
      {/* PHONE: edge to edge along the bottom, one top hairline, the home
          indicator's inset as padding INSIDE the bar. Whatever this measures,
          --tabbar-h in globals.css has to match it. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-cream/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:bg-ink/95 print:hidden pad:hidden"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((t) => {
          const on = t.key === active;
          const Icon = ICONS[t.key] ?? PinIcon;
          return (
            <Link
              key={t.key}
              href={t.href + qs}
              aria-current={on ? "page" : undefined}
              onClick={guard}
              // `active:` is the PRESS (paints the instant a finger lands); the
              // overlay below is the WAIT (only while the navigation is in flight).
              className={`relative flex h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10.5px] font-semibold leading-tight transition active:bg-accent/15 ${
                on ? "text-accent dark:text-accent-soft" : "text-neutral-500 hover:text-accent dark:text-neutral-400"
              }`}
            >
              {/* The active mark is a short ochre rule above the icon — the
                  same rule <SectionHeading> uses. */}
              <span aria-hidden className={`h-0.5 w-4 shrink-0 rounded-full ${on ? "bg-accent" : "bg-transparent"}`} />
              <Icon />
              {labelOf(t)}
              <LinkPendingOverlay spinnerClassName="h-5 w-5" />
            </Link>
          );
        })}
      </nav>

      {/* iPAD AND UP: a rail down the left edge with every workspace; from 2xl
          a sidebar that also lists the current workspace's pages. Its width is
          --rail-w in globals.css, which is what the page moves right by. */}
      <nav
        aria-label="Workspaces"
        className="fixed inset-y-0 left-0 z-30 hidden w-[88px] flex-col gap-0.5 overflow-y-auto border-r border-line bg-cream/95 px-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur dark:bg-ink/95 print:hidden pad:flex 2xl:w-[232px] 2xl:px-3"
      >
        {rail.map((t) => {
          const on = t.key === railActive;
          const Icon = ICONS[t.key] ?? PinIcon;
          const ws = on && t.workspace ? WORKSPACES.find((w) => w.id === t.workspace) : undefined;
          return (
            <div key={t.key}>
              <Link
                href={t.href + qs}
                aria-current={on ? "page" : undefined}
                onClick={guard}
                className={`relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[10.5px] font-semibold leading-tight transition active:bg-accent/15 2xl:flex-row 2xl:gap-3 2xl:px-3 2xl:text-left 2xl:text-[13px] ${
                  on
                    ? "bg-accent/10 text-accent dark:text-accent-soft"
                    : "text-neutral-500 hover:text-accent dark:text-neutral-400"
                }`}
              >
                <Icon />
                <span className="min-w-0">{labelOf(t)}</span>
                <LinkPendingOverlay spinnerClassName="h-5 w-5" />
              </Link>
              {/* The sidebar's second level: the current workspace's pages. */}
              {ws && (
                <div className="hidden space-y-0.5 pb-1 pl-9 pt-0.5 2xl:block">
                  {reachableTabs(ws, access.can).map((tab) => {
                    const here = pathname === tab.href || pathname.startsWith(tab.href + "/");
                    return (
                      <Link
                        key={tab.view}
                        href={tab.href + carryJobAndMonth(search)}
                        onClick={guard}
                        aria-current={here ? "page" : undefined}
                        className={`block truncate rounded-lg px-2 py-1.5 text-[12.5px] transition ${
                          here
                            ? "font-semibold text-ink dark:text-cream"
                            : "text-neutral-500 hover:text-accent dark:text-neutral-400"
                        }`}
                      >
                        {c(`home.dest.${tab.view}.label`) || tab.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}

