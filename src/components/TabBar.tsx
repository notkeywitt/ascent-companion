"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";
import { activeBarKey, barFor } from "@/lib/workspaces";

/**
 * Bottom tab bar — up to five slots, docked at thumb height.
 *
 * The slots come from BARS in src/lib/workspaces.ts, per role: Today, a whole
 * WORKSPACE (Month Close goes to its first tab the person can open), or one
 * page (Miles). Every slot is gated on the same view ids as the middleware, so
 * a slot someone cannot open is simply absent. EVERY role gets a bar, leads
 * included (owner, 2026-09-29): it is the way home from any page, and the
 * header's ☰ menu carries everything else.
 *
 * FROM `pad` UP IT IS A DOCK, not a bar: fixed-width items, a rounded pill,
 * centred, a finger's width off the bottom edge. Same slots, same gates — only
 * the furniture changes, and it changes in CSS.
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
const ClipboardIcon = () => (
  <IconBase>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    <path d="M9 12h6M9 16h4" />
  </IconBase>
);

/** A slot's icon, by its key (a workspace id, a view id, or "today"). */
const ICONS: Record<string, () => React.ReactNode> = {
  today: HomeIcon,
  close: BanknoteIcon,
  incoming: InboxIcon,
  office: ComputerIcon,
  mywork: BriefcaseIcon,
  "employee-time": ClockIcon,
  mileage: RouteIcon,
  tools: WrenchIcon,
  requisitions: ClipboardIcon,
  "time-off": CalendarIcon,
};

export function TabBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const access = useAccess();
  const c = useCopy();

  // The bar is chrome for the signed-in app; these two pages have none.
  if (pathname === "/login" || pathname === "/privacy") return null;

  const items = barFor(access.role, access.can);
  // One slot is decoration, and it would cost every page 56px to say nothing.
  if (items.length < 2) return null;
  const active = activeBarKey(items, pathname);

  // Carry the selected job across, so hopping to a page from a job keeps it.
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  return (
    <nav
      aria-label="Main"
      // The two shapes, in one class string.
      //   phone — edge to edge along the bottom, one top hairline, the home
      //           indicator's inset as padding INSIDE the bar.
      //   pad+  — shrink to its items, centre on the screen, sit a finger's
      //           width up from the edge with the indicator's inset added to
      //           that gap instead of padded inside the pill. `overflow-hidden`
      //           is what keeps a tab's press tint inside the rounded corners.
      // Whatever this ends up measuring, --tabbar-h in globals.css has to match
      // it — that is the number every docked panel and page offsets by.
      className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-cream/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:bg-ink/95 print:hidden pad:inset-x-auto pad:bottom-[calc(1rem_+_env(safe-area-inset-bottom))] pad:left-1/2 pad:w-auto pad:-translate-x-1/2 pad:overflow-hidden pad:rounded-2xl pad:border pad:pb-0 pad:shadow-lg"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((t) => {
        const on = t.key === active;
        const Icon = ICONS[t.key] ?? HomeIcon;
        // A single-page slot takes the short bar word the office can reword;
        // a workspace or Today says its own name.
        const label = !t.workspace && t.view ? c(`home.quick.${t.view}.label`) || t.label : t.label;
        return (
          <Link
            key={t.key}
            href={t.href + qs}
            aria-current={on ? "page" : undefined}
            // The job picker and the bill editor both guard unsaved work; a tab
            // is a navigation like any other, so it asks the same question.
            onClick={(e) => {
              if (!confirmLeaveIfDirty()) e.preventDefault();
            }}
            // `active:` is the PRESS (paints the instant a finger lands); the
            // overlay below is the WAIT (only while the navigation is in
            // flight). A fixed width from `pad` up keeps the dock's items even.
            className={`relative flex h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10.5px] font-semibold leading-tight transition active:bg-accent/15 pad:w-[118px] ${
              on ? "text-accent dark:text-accent-soft" : "text-neutral-500 hover:text-accent dark:text-neutral-400"
            }`}
          >
            {/* The active mark is a short ochre rule above the icon — the same
                rule <SectionHeading> uses. */}
            <span aria-hidden className={`h-0.5 w-4 shrink-0 rounded-full ${on ? "bg-accent" : "bg-transparent"}`} />
            <Icon />
            {label}
            <LinkPendingOverlay spinnerClassName="h-5 w-5" />
          </Link>
        );
      })}
    </nav>
  );
}
