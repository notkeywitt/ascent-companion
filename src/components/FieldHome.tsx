"use client";

import Link from "next/link";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { FIELD_QUICK, FIELD_REST, FIELD_REST_HREF, type Dest } from "@/lib/nav";

/**
 * The FIELD launcher — what a crew member sees on the home page.
 *
 * Four buttons, nothing else: Miles · Time · Tools · The Rest. A phone in a
 * work glove gets three big targets for the pages opened every day, and one
 * door to everything else (/more), so no one scrolls past twenty office rows
 * to reach the mileage form.
 *
 * The office/admin launcher (the area lists in src/app/page.tsx) is untouched —
 * this renders only for the `field` role, and the admin role-preview lens shows
 * it too, so the owner can check this page from /admin without a second login.
 *
 * WHAT SHOWS HERE IS CURATED IN src/lib/nav.ts (FIELD_QUICK + FIELD_REST).
 * Every tile is still gated on the same view id as the launcher and the
 * middleware, so a tile can never lead somewhere the user gets bounced from.
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

/** Icon per view id; a destination added to FIELD_QUICK without one falls back. */
const ICONS: Record<string, () => React.ReactNode> = {
  mileage: RouteIcon,
  "employee-time": ClockIcon,
  tools: WrenchIcon,
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

export function FieldHome({ qs = "" }: { qs?: string }) {
  const access = useAccess();
  const c = useCopy();

  const label = (d: Dest) => c(`home.quick.${d.view}.label`) || d.label;
  const quick = FIELD_QUICK.filter((d) => access.can(d.view));
  // The fourth button is pointless with nothing behind it.
  const restCount = FIELD_REST.filter((d) => access.can(d.view)).length;

  return (
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
          href={FIELD_REST_HREF + qs}
          label={c("home.quick.more.label") || "The Rest"}
          Icon={GridIcon}
        />
      )}
    </div>
  );
}
