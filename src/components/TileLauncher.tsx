"use client";

import Link from "next/link";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { MORE_HREF, tileLauncherFor, type Dest } from "@/lib/nav";

/**
 * The TILE launcher — what a field, lead, or office user sees on the home page.
 *
 * Big buttons, nothing else: field gets four (Miles · Time · Tools · The
 * Rest), lead gets six (those three, plus Tracking Sheets and Requisitions,
 * before The Rest), office gets four (Tools · Requisitions · Time Off · The
 * Rest — Tracking Sheets/Time/Miles stay off the grid because office keeps the
 * bottom tab bar, which already carries them). A phone in a work glove gets
 * large targets for the pages opened every day and one door to everything
 * else (/more), instead of scrolling past twenty office rows to reach the
 * mileage form.
 *
 * The admin launcher (the area lists in src/app/page.tsx) is untouched — this
 * renders only for roles listed in TILE_LAUNCHERS, and the admin role-preview
 * lens shows it too, so the owner can check any of the three from /admin
 * without a second login.
 *
 * WHAT SHOWS HERE IS CURATED IN src/lib/nav.ts (TILE_LAUNCHERS). Every tile is
 * still gated on the same view id as the launcher and the middleware, so a tile
 * can never lead somewhere the user gets bounced from.
 */

/* Flat 2px line icons on a 24×24 grid — the same set the tab bar draws. */
const IconBase = ({ children }: { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-8 w-8"
    aria-hidden
  >
    {children}
  </svg>
);

const RouteIcon = () => (
  <IconBase>
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </IconBase>
);
const ClockIcon = () => (
  <IconBase>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </IconBase>
);
const WrenchIcon = () => (
  <IconBase>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </IconBase>
);
const BanknoteIcon = () => (
  <IconBase>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </IconBase>
);
const ClipboardIcon = () => (
  <IconBase>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    <path d="M9 12h6M9 16h4" />
  </IconBase>
);
const SunIcon = () => (
  <IconBase>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </IconBase>
);
const GridIcon = () => (
  <IconBase>
    <circle cx="6" cy="6" r="1.6" />
    <circle cx="12" cy="6" r="1.6" />
    <circle cx="18" cy="6" r="1.6" />
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
    <circle cx="6" cy="18" r="1.6" />
    <circle cx="12" cy="18" r="1.6" />
    <circle cx="18" cy="18" r="1.6" />
  </IconBase>
);

/** Icon per view id; a tile added without one falls back to the grid mark. */
const ICONS: Record<string, () => React.ReactNode> = {
  mileage: RouteIcon,
  "employee-time": ClockIcon,
  tools: WrenchIcon,
  recode: BanknoteIcon,
  requisitions: ClipboardIcon,
  "time-off": SunIcon,
};

export function FieldTile({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: () => React.ReactNode;
}) {
  return (
    <Link
      href={href}
      // Big, square, thumb-first. `active:` paints on the press so the tap is
      // never in doubt; the overlay covers the wait on a job-site connection.
      className="relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-white px-3 text-center transition active:bg-accent/15 hover:border-accent dark:bg-ink-raised"
    >
      <span className="text-accent dark:text-accent-soft">
        <Icon />
      </span>
      <span className="text-[15px] font-semibold leading-tight">{label}</span>
      <LinkPendingOverlay spinnerClassName="h-6 w-6" />
    </Link>
  );
}

export function TileLauncher({ qs = "" }: { qs?: string }) {
  const access = useAccess();
  const c = useCopy();

  const launcher = tileLauncherFor(access.role);
  const label = (d: Dest) => c(`home.quick.${d.view}.label`) || d.label;
  const quick = (launcher?.quick ?? []).filter((d) => access.can(d.view));
  // The last button is pointless with nothing behind it.
  const restCount = (launcher?.rest ?? []).filter((d) => access.can(d.view)).length;

  return (
    <div className="space-y-4">
      {/* The office digest that used to be a "coming soon" placeholder here is
          now the real <DailyDigest /> card, rendered ABOVE this launcher by
          src/app/page.tsx — the same card admin sees, gated on the `digest`
          view, which office now holds (src/lib/views.ts). Nothing to reserve. */}
      <div className="grid grid-cols-2 gap-3">
        {quick.map((d) => (
          <FieldTile
            key={d.href}
            href={d.href + qs}
            label={label(d)}
            Icon={ICONS[d.view] ?? GridIcon}
          />
        ))}
        {restCount > 0 && (
          <FieldTile
            href={MORE_HREF + qs}
            label={c("home.quick.more.label") || "The Rest"}
            Icon={GridIcon}
          />
        )}
      </div>
    </div>
  );
}
