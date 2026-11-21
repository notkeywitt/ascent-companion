"use client";

import { RailWidgetButton } from "@/components/RailWidgetButton";
import { openNotesBug } from "@/components/NotesBug";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/Sheet";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { toggleKloi, useKloi } from "@/lib/kloi";
import { AppMenu } from "@/components/AppMenu";
import { carryJobAndMonth } from "@/lib/urlParam";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";
import {
  BAR_PIN_EVENT,
  BAR_PIN_KEY,
  MENU_SINGLE_WORKSPACES,
  WORKSPACES,
  activeBarKey,
  barFor,
  drawerFor,
  RAIL_OFF_VIEWS,
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
 * THE DRAWER (owner, 2026-10-29/30; on `Sheet` since 2026-11-13, OVERHAUL_PLAN
 * 3.3): the ☰ menu (`AppMenu`), since 2026-11-15. A swipe up on the bar opens
 * it at half height; it drags up to full. A swipe down, a tap outside, Escape or any
 * navigation closes it. Phone only: the rail already lists everything.
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
    className="h-[19px] w-[19px] shrink-0"
    aria-hidden
  >
    {children}
  </svg>
);

/** A house — the Jobs page. */
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
const BadgeIcon = () => (
  <IconBase>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M8 17a4 4 0 0 1 8 0" />
  </IconBase>
);
const UserIcon = () => (
  <IconBase>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </IconBase>
);
const SearchIcon = () => (
  <IconBase>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </IconBase>
);
/** The Ascent mark: the notched double peak, drawn as a line. Home. */
const MountainIcon = () => (
  <IconBase>
    <path d="M3 18 8.7 7.6l1.8.9L14.1 6 21 18z" />
  </IconBase>
);
const ToolCalendarIcon = () => (
  <IconBase>
    <path d="M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6M8 2v4M16 2v4M4 10h16" />
    <path d="m21.7 16.3-3.1 3.1a1.4 1.4 0 0 1-2-2l3.1-3.1a3 3 0 0 0-3.5 3.5l-3 3a1.4 1.4 0 0 0 2 2l3-3" />
  </IconBase>
);
const ShieldIcon = () => (
  <IconBase>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.1 8 9 4.6-.9 8-4.5 8-9V6z" />
  </IconBase>
);
/** A pinned page, which has no icon of its own. */
/** KLOI — play triangle, or pause bars while it plays. */
const RadioIcon = ({ playing }: { playing: boolean }) => (
  <IconBase>{playing ? <path d="M9 5v14M15 5v14" /> : <path d="M7 5l12 7-12 7z" />}</IconBase>
);
/** LopezRocks — the island's rocks. */
const RocksIcon = () => (
  <IconBase>
    <path d="M3 20 9 10l4 6 3-4 5 8z" />
  </IconBase>
);
/** Boids — a small flock of arrowheads. */
const BoidsIcon = () => (
  <IconBase>
    <path d="M4 8l5 2-5 2zM12 4l5 2-5 2zM13 14l6 2.5-6 2.5z" />
  </IconBase>
);
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

const CheckIcon = () => (
  <IconBase>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="m8 12 3 3 5-6" />
  </IconBase>
);
const DocumentIcon = () => (
  <IconBase>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </IconBase>
);
const UserPlusIcon = () => (
  <IconBase>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" />
  </IconBase>
);
const PayrollIcon = () => (
  <IconBase>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M14.5 9.5h-3.25a1.75 1.75 0 0 0 0 3.5h1.5a1.75 1.75 0 0 1 0 3.5H9.5M12 8v1.5M12 16.5V18" />
  </IconBase>
);
const MessageIcon = () => (
  <IconBase>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </IconBase>
);
const MapPinIcon = () => (
  <IconBase>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </IconBase>
);
const RoadmapIcon = () => (
  <IconBase>
    <path d="M4 20V4" />
    <path d="M4 5h13l-2.5 3.5L17 12H4" />
  </IconBase>
);
const MailIcon = () => (
  <IconBase>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </IconBase>
);
const SafetyIcon = () => (
  <IconBase>
    <path d="M4 15a8 8 0 0 1 16 0M2 15h20v3H2zM12 7V4M9 15V9.5M15 15V9.5" />
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

/** A half-built house: roof and studs on the left, finished wall on the right. */
const HalfHouseIcon = () => (
  <IconBase>
    <path d="M3 11 12 3l9 8M5 10v11h14V10" />
    <path d="M12 3v18M5 14h7M5 18h7M8 10v11" />
  </IconBase>
);

/** A storefront — the Vendors page. */
const StoreIcon = () => (
  <IconBase>
    <path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v0a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8M10 20v-5h4v5" />
  </IconBase>
);

/** A hard hat — the Labor page, apart from the Time clock. */
const HardHatIcon = () => (
  <IconBase>
    <path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 6v6M8.5 8.5 9 12M15.5 8.5 15 12" />
  </IconBase>
);

/** A slot's icon, by its key (a workspace id, a view id, or "today"). */
const ICONS: Record<string, () => React.ReactNode> = {
  today: MountainIcon,
  "jobs-hub": HomeIcon,
  close: BanknoteIcon,
  incoming: InboxIcon,
  office: ComputerIcon,
  mywork: BriefcaseIcon,
  clients: HalfHouseIcon,
  people: BadgeIcon,
  employees: UserIcon,
  search: SearchIcon,
  admin: ShieldIcon,
  time: ClockIcon,
  "employee-time": ClockIcon,
  mileage: RouteIcon,
  tools: WrenchIcon,
  "tool-schedule": ToolCalendarIcon,
  requisitions: ClipboardIcon,
  "job-board": HalfHouseIcon,
  vendors: StoreIcon,
  "time-off": CalendarIcon,
  "time-sync": PayrollIcon,
  labor: HardHatIcon,
  "invoice-review": CheckIcon,
  "invoicing-summary": DocumentIcon,
  "new-hires": UserPlusIcon,
  "labor-rates": PayrollIcon,
  "safety-meeting": SafetyIcon,
  bills: InboxIcon,
  email: MailIcon,
  "bill-search": SearchIcon,
  leads: UserPlusIcon,
  requests: MessageIcon,
  roadmap: RoadmapIcon,
  chat: MessageIcon,
  lopezrocks: MapPinIcon,
};

/** Where the drawer's second icon row is kept (per device), and its first picks. */
const DRAWER_ROW_KEY = "bar.drawerRow";
const DRAWER_DEFAULT = ["leads", "vendors", "labor", "time-off", "roadmap"];

export function TabBar() {
  const kloi = useKloi();
  const pathname = usePathname();
  const search = useSearchParams();
  const access = useAccess();
  const isHereRoot = (href: string) => pathname === href || pathname.startsWith(href + "/");
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

  // The drawer's second icon row: five page ids this device chose (owner, request 42).
  const [mine, setMine] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(DRAWER_ROW_KEY) ?? "[]");
      if (Array.isArray(v)) setMine(v.filter((x) => typeof x === "string"));
    } catch {
      /* storage blocked or bad JSON — the default row */
    }
  }, []);
  const pick = (i: number, view: string) => {
    const next = drawerRow.slice();
    next[i] = view;
    setMine(next);
    try {
      localStorage.setItem(DRAWER_ROW_KEY, JSON.stringify(next));
    } catch {}
  };
  // The drawer. It closes on any navigation, a back swipe included.
  const [open, setOpen] = useState(false);
  // The rail can slide away for a full-width page (owner, 2026-11-01). The
  // layout's inline script set the attribute before paint; this mirrors it.
  const [railHidden, setRailHidden] = useState(false);
  useEffect(() => {
    setRailHidden(document.documentElement.dataset.rail === "hidden");
  }, []);
  const toggleRail = () => {
    const next = !railHidden;
    setRailHidden(next);
    if (next) document.documentElement.dataset.rail = "hidden";
    else delete document.documentElement.dataset.rail;
    try {
      // Collapsed is the default; "0" records a pinned-open rail.
      if (next) localStorage.removeItem("railHidden");
      else localStorage.setItem("railHidden", "0");
    } catch {}
  };
  useEffect(() => setOpen(false), [pathname]);
  // PEEK (owner, 2026-11-14): a mouse resting on the narrow or hidden rail
  // opens the full sidebar OVER the page; --rail-w does not change, so the
  // page does not move. Mouse only: a tap on an iPad is not a hover. A short
  // delay each way, so a mouse crossing the rail does not flash it open.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekLater = (on: boolean, e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(on), on ? 150 : 250);
  };
  useEffect(() => () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
  }, []);
  // A swipe up on the bar opens the drawer, like a sheet's handle.
  const touchY = useRef<number | null>(null);
  // How far the finger has pulled the bar up (px). The bar follows it, with a
  // rubber-band ease, so the swipe reads as a handle, then springs back.
  const [lift, setLift] = useState(0);

  // The bar is chrome for the signed-in app; these two pages have none.
  if (pathname === "/login" || pathname === "/privacy") return null;

  const baseItems = barFor(access.role, access.can, pin);
  const baseMore = drawerFor(access.role, access.can, pin, access.menu);
  // A page picked from the drawer takes the bar's centre slot, lit, so the
  // collapsed bar names the current page. The slot it displaces takes its place
  // in the drawer, so nothing becomes unreachable. A page a bar slot already
  // covers keeps the plain bar.
  const hereIn = (i: BarItem) => i.covers.some((href) => isHereRoot(href));
  const onBar = baseItems.some((i) => (i.key === "today" ? pathname === "/" : hereIn(i)));
  const drawerIdx = onBar || baseItems.length < 3 ? -1 : baseMore.findIndex(hereIn);
  const centre = Math.floor(baseItems.length / 2);
  const items = baseItems.slice();
  const more = baseMore.slice();
  if (drawerIdx >= 0) {
    items[centre] = baseMore[drawerIdx];
    more[drawerIdx] = baseItems[centre];
  }
  const rail = railFor(access.role, access.can, pin, access.menu);
  // One slot is decoration, and it would cost every page 56px to say nothing.
  if (items.length < 2) return null;
  const active = activeBarKey(items, pathname);
  const railActive = activeBarKey(rail, pathname);
  // The drawer's icon row: five pages the role may open. Saved picks win; a
  // page the role cannot open is dropped; Customers and sensible pages fill the rest.
  const options = WORKSPACES.flatMap((w) => reachableTabs(w, access.can)).filter(
    (t, i, a) => a.findIndex((x) => x.view === t.view) === i,
  );
  const chosen = mine.filter((v, i) => options.some((o) => o.view === v) && mine.indexOf(v) === i);
  const fill = [...DRAWER_DEFAULT, ...options.map((o) => o.view)].filter(
    (v) => options.some((o) => o.view === v) && !items.some((b) => b.view === v && !b.workspace),
  );
  const drawerRow = [...chosen, ...fill.filter((v) => !chosen.includes(v))].slice(0, 5);
  const drawerIcons: BarItem[] = drawerRow.map((v) => {
    const t = options.find((o) => o.view === v)!;
    return { key: t.view, label: t.label, href: t.href, view: t.view, covers: [t.href] };
  });

  // Carry the selected job across, so hopping to a page from a job keeps it.
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  // A single-page slot takes the short bar word the office can reword; a
  // workspace or Today says its own name.
  const labelOf = (t: BarItem) =>
    !t.workspace && t.view ? c(`home.quick.${t.view}.label`) || t.label : t.label;
  // The job picker and the bill editor both guard unsaved work; a slot is a
  // navigation like any other, so it asks the same question.
  const guard = (e: React.MouseEvent) => {
    if (!confirmLeaveIfDirty()) e.preventDefault();
  };

  return (
    <>
      {/* PHONE: edge to edge along the bottom, translucent glass that follows
          the theme (cream in light, near-black in dark), a hairline top line, the home indicator's inset as padding
          INSIDE the bar. The bar is --tabbar-h in globals.css.
          The glass is a LAYER, not the nav's own backdrop-filter, and the tab
          has no tab. Its marks are ink-dark in
          light and white in dark. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 touch-none rounded-t-sheet border-t border-line bg-white pb-[env(safe-area-inset-bottom)] text-neutral-900 shadow-xl dark:bg-ink-overlay dark:text-white print:hidden pad:hidden"
        // `touch-none`: a drag that starts on the bar must not pan the window.
        // The bar sits outside #app-shell, so iOS scrolls the window instead
        // and the whole app, bar included, slides up. Taps and this swipe still work.
        onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
        onTouchMove={(e) => {
          const start = touchY.current;
          if (start === null) return;
          const up = Math.max(0, start - e.touches[0].clientY);
          setLift(Math.min(28, up * 0.45));
        }}
        onTouchEnd={(e) => {
          const start = touchY.current;
          touchY.current = null;
          setLift(0);
          if (start !== null && start - e.changedTouches[0].clientY > 30)
            setOpen(true);
        }}
        onTouchCancel={() => {
          touchY.current = null;
          setLift(0);
        }}
        style={{
          transform: lift ? `translateY(${-lift}px)` : undefined,
          transition: lift ? "none" : "transform 220ms cubic-bezier(.2,.9,.3,1.2)",
        }}
      >
        {/* The grabber: wider and darker while a finger pulls, so the bar
            reads as something that slides up. */}
        <div className="flex justify-center pt-1.5" aria-hidden>
          <div
            className={`h-1 rounded-pill transition-all duration-150 ${
              lift > 0
                ? "w-14 bg-neutral-500 dark:bg-neutral-300"
                : "w-10 bg-neutral-300 dark:bg-neutral-600"
            }`}
          />
        </div>
        <div
          className="relative grid"
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
                className={`relative flex h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[11px] font-semibold leading-tight transition active:bg-black/5 dark:active:bg-white/10 ${
                  on
                    ? "text-neutral-900 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-white/60 dark:hover:text-white"
                }`}
              >
                {/* The active mark is a short rule above the icon, in the text colour. */}
                <span
                  aria-hidden
                  className={`h-0.5 w-4 shrink-0 rounded-pill ${on ? "bg-current" : "bg-transparent"}`}
                />
                <Icon />
                {labelOf(t)}
                <LinkPendingOverlay spinnerClassName="h-5 w-5" />
              </Link>
            );
          })}
        </div>
      </nav>

      {/* The drawer: the ☰ menu, opened by a swipe up on the bar. Phone only. */}
      <div className="pad:hidden">
        {(() => {
          // Icon rows styled like the home row. They live in the sheet, so they
          // are hidden while the drawer is closed.
          const top =
            drawerIcons.length > 0 ? (
              <div>
              <div className="grid grid-cols-5">
                {drawerIcons.map((t, i) => {
                  if (editing)
                    return (
                      <select
                        key={i}
                        aria-label={`Slot ${i + 1}`}
                        value={t.view}
                        onChange={(e) => pick(i, e.target.value)}
                        className="h-14 min-w-0 rounded-card bg-transparent px-0.5 text-center text-[11px] font-semibold"
                      >
                        {options.map((o) => (
                          <option key={o.view} value={o.view}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    );
                  const on = t.key === railActive;
                  const Icon = ICONS[t.key] ?? PinIcon;
                  return (
                    <Link
                      key={t.key}
                      href={t.href + qs}
                      aria-current={on ? "page" : undefined}
                      onClick={guard}
                      className={`relative flex h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[11px] font-semibold leading-tight transition active:bg-black/5 dark:active:bg-white/10 ${
                        on
                          ? "text-neutral-900 dark:text-white"
                          : "text-neutral-500 hover:text-neutral-900 dark:text-white/60 dark:hover:text-white"
                      }`}
                    >
                      <Icon />
                      {labelOf(t)}
                      <LinkPendingOverlay spinnerClassName="h-5 w-5" />
                    </Link>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                className="mx-auto block px-2 py-1 text-[11px] font-semibold text-neutral-500 dark:text-white/60"
              >
                {editing ? "Done" : "Edit icons"}
              </button>
              </div>
            ) : null;
          if (access.role === "field")
            return <AppMenu themeOnly open={open} onOpenChange={setOpen} />;
          return access.role === "office" ? (
            <AppMenu account pages qs={qs} top={top} open={open} onOpenChange={setOpen} />
          ) : (
            <AppMenu qs={qs} top={top} open={open} onOpenChange={setOpen} />
          );
        })()}
      </div>

      {/* iPAD AND UP: a rail down the left edge with every workspace; from 2xl
          a sidebar that also lists the current workspace's pages. Its width is
          --rail-w in globals.css, which is what the page moves right by. */}
      <nav
        aria-label="Workspaces"
        data-peek={peek || undefined}
        onPointerEnter={(e) => peekLater(true, e)}
        onPointerLeave={(e) => peekLater(false, e)}
        className={`rail-nav fixed inset-y-0 left-0 z-30 hidden w-[88px] flex-col gap-0.5 overflow-y-auto border-r border-line bg-page/95 px-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur transition-[width] duration-200 ease-out data-[peek]:shadow-xl dark:bg-ink/95 print:hidden pad:flex wide:w-[232px] wide:px-2`}
      >
        {rail.map((t) => {
          const on = t.key === railActive;
          const Icon = ICONS[t.key] ?? PinIcon;
          return (
            <div key={t.key} className={`group ${t.gap ? "mt-5" : ""}`}>
              <Link
                href={t.href + qs}
                aria-current={on ? "page" : undefined}
                onClick={guard}
                className={`relative flex flex-col items-center gap-1 rounded-card px-1 py-2 text-center text-[11px] font-semibold leading-tight transition active:bg-accent/15 wide:flex-row wide:gap-3 wide:px-2 wide:text-left wide:text-[13px] ${
                  on
                    ? `bg-accent/10 text-accent dark:text-accent-soft`
                    : "text-neutral-500 hover:text-accent dark:text-neutral-400"
                }`}
              >
                <Icon />
                <span className="rail-label min-w-0">{labelOf(t)}</span>
                <LinkPendingOverlay spinnerClassName="h-5 w-5" />
              </Link>
            </div>
          );
        })}
        {/* Account — Appearance, alerts, the Assistant and Sign out. The ☰ menu
            held them, and it is hidden from `pad` up. */}
        <div className="mt-auto pt-2">
          {/* LopezRocks, above Account (owner, 2026-11-02): it left the home
              page when Admin and Office moved to the Jobs page. */}
          {/* Notes: opens the floating Notes card (NotesBug). Desktop only. */}
          <button
            type="button"
            onClick={openNotesBug}
            title="Jot a note, bug or feature request"
            className="relative mb-1 hidden w-full flex-col items-center gap-1 rounded-card px-1 py-2 text-center text-[11px] font-semibold leading-tight text-neutral-500 transition hover:text-accent active:bg-accent/15 dark:text-neutral-400 lg:flex wide:flex-row wide:gap-3 wide:px-2 wide:text-left wide:text-[13px]"
          >
            <ClipboardIcon />
            <span className="rail-label min-w-0">Notes</span>
          </button>
          <button
            type="button"
            onClick={toggleKloi}
            aria-pressed={kloi.playing}
            title={
              kloi.failed
                ? "The stream did not start. Try again."
                : "Lopez Island's radio station, live"
            }
            className={`relative mb-1 flex w-full flex-col items-center gap-1 rounded-card px-1 py-2 text-center text-[11px] font-semibold leading-tight transition active:bg-accent/15 wide:flex-row wide:gap-3 wide:px-2 wide:text-left wide:text-[13px] ${
              kloi.playing
                ? "bg-accent/10 text-accent dark:text-accent-soft"
                : "text-neutral-500 hover:text-accent dark:text-neutral-400"
            }`}
          >
            <RadioIcon playing={kloi.playing} />
            <span className="rail-label min-w-0">
              {kloi.playing ? "Pause KLOI" : "Listen to KLOI"}
            </span>
          </button>
          {access.can("lopezrocks") && (
            <Link
              href="/lopezrocks"
              aria-current={isHereRoot("/lopezrocks") ? "page" : undefined}
              onClick={guard}
              className={`relative mb-1 flex flex-col items-center gap-1 rounded-card px-1 py-2 text-center text-[11px] font-semibold leading-tight transition active:bg-accent/15 wide:flex-row wide:gap-3 wide:px-2 wide:text-left wide:text-[13px] ${
                isHereRoot("/lopezrocks")
                  ? "bg-accent/10 text-accent dark:text-accent-soft"
                  : "text-neutral-500 hover:text-accent dark:text-neutral-400"
              }`}
            >
              <RocksIcon />
              <span className="rail-label min-w-0">LopezRocks</span>
              <LinkPendingOverlay spinnerClassName="h-5 w-5" />
            </Link>
          )}
          {access.can("art") && (
            <Link
              href="/art/flock"
              aria-current={isHereRoot("/art/flock") ? "page" : undefined}
              onClick={guard}
              className={`relative mb-1 flex flex-col items-center gap-1 rounded-card px-1 py-2 text-center text-[11px] font-semibold leading-tight transition active:bg-accent/15 wide:flex-row wide:gap-3 wide:px-3 wide:text-left wide:text-[13px] ${
                isHereRoot("/art/flock")
                  ? "bg-accent/10 text-accent dark:text-accent-soft"
                  : "text-neutral-500 hover:text-accent dark:text-neutral-400"
              }`}
            >
              <BoidsIcon />
              <span className="rail-label min-w-0">Boids</span>
              <LinkPendingOverlay spinnerClassName="h-5 w-5" />
            </Link>
          )}
          <AppMenu account />
          {/* The desktop widget's launcher sits beside the Hide arrow (owner,
              2026-11-11). Narrow rail: two small buttons in a row. */}
          <div className="rail-foot mt-1 flex h-[4.75rem] items-start justify-center gap-0.5 wide:justify-start">
            <RailWidgetButton />
            <button
              type="button"
              onClick={toggleRail}
              aria-label={railHidden ? "Show the labels" : "Hide the labels"}
              title={railHidden ? "Show the labels" : "Hide the labels"}
              className="flex flex-1 items-center justify-center rounded-card py-2 text-[15px] text-neutral-500 hover:text-accent dark:text-neutral-400 wide:justify-start wide:px-2"
            >
              {railHidden ? "›" : "‹"}
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}
