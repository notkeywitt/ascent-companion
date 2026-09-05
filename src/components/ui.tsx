/**
 * Shared UI primitives — the Assistant's design system in one place.
 *
 * Every page previously hand-rolled its buttons, inputs, cards, banners, and
 * empty states, so paddings/radii/colors drifted page by page. These primitives
 * pin the brand look (Brand Guidelines, May 2024) and the dark-mode surface
 * scale (cards sit LIGHTER than the page — bg-ink-raised). Each theme uses one
 * brand pairing — light = cream + ochre, dark = off-black + olive green — which
 * the theme-variable `accent` / `brand` colors resolve; see globals.css.
 *
 * Class-string helpers (`btn`, `inputCls`) are exported for the cases where a
 * component wrapper is awkward (e.g. a Next <Link> styled as a button).
 */

import Link from "next/link";
import { PageTitle, PeakMark } from "@/components/PageTitle";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";

// Spinner moved to its own module to keep ui → LinkPending a one-way import
// (see components/Spinner.tsx). Re-exported so existing call sites are unchanged.
export { Spinner };

/* ------------------------------------------------------------------ buttons */

export type BtnVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type BtnSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover",
  secondary:
    "border border-neutral-300 text-neutral-700 hover:border-accent hover:text-accent dark:border-neutral-600 dark:text-neutral-300 dark:hover:border-accent",
  outline: "border border-accent text-accent hover:bg-accent/10",
  ghost: "text-neutral-500 hover:text-accent dark:hover:text-accent-soft",
  danger:
    "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40",
};

const BTN_SIZE: Record<BtnSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-4 py-2.5 text-sm",
};

/** Button classes as a string — for <Link>/<a> elements styled as buttons. */
export function btn(variant: BtnVariant = "primary", size: BtnSize = "md", extra = ""): string {
  return `${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]}${extra ? " " + extra : ""}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: BtnSize;
}) {
  return <button type="button" {...props} className={btn(variant, size, className)} />;
}

/* ------------------------------------------------------------- icon button */

export type IconBtnTone = "default" | "danger";

/**
 * Square icon-only button with a thumb-sized hit area. Pages used to hand-roll
 * these as a 14–16px glyph in `p-1`/`p-1.5`, i.e. a 22–28px target — under
 * WCAG 2.5.5's 44×44 (and 22px is under even the 2.5.8 AA floor of 24), which
 * on a phone means the delete and buy-back icons sitting next to each other in
 * a line row were a coin flip to hit. The GLYPH stays small (the caller sizes
 * its own svg), so a dense row still reads light; the 44px comes from padding.
 */
export function IconButton({
  tone = "default",
  label,
  title,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: IconBtnTone; label: string }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${
        tone === "danger"
          ? "text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          : "text-neutral-500 hover:bg-accent/10 hover:text-accent dark:text-neutral-400 dark:hover:bg-accent/20 dark:hover:text-accent-soft"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ toggles */

/**
 * A labeled on/off switch — the interactive equivalent of a checkbox, styled as
 * a sliding pill (theme accent when on). Uses role="switch" so it is keyboard-
 * and screen-reader-correct. Prefer this over a raw <input type="checkbox">.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex cursor-pointer items-center gap-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          checked ? "bg-accent" : "bg-neutral-300 dark:bg-neutral-600"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------- inputs */

/** Shared text-input / select / textarea classes. */
export const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm transition placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-ink-raised";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${className}`} />;
}

export function Select({
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${className}`} />;
}

/**
 * A QUIET field — same size and behaviour as `Input`, but it carries no border
 * of its own until it is focused.
 *
 * A dense editing surface (a bill's line items) puts three or four fields on
 * every row, and a bordered box around each one costs a rectangle per field:
 * eight lines of a bill drew ~30 boxes, which is what made the page read as
 * a wall of edges rather than a list of numbers. A soft fill says "you can
 * type here" just as clearly as a stroke does (the same trade Material's
 * filled fields and GitHub Primer make), and the border returns on focus so
 * the field you are actually in is the only one outlined.
 *
 * `border-transparent` — not "no border" — is what keeps the row from shifting
 * by a pixel when focus adds one.
 *
 * Carries NO width, unlike `inputCls`. Tailwind resolves two competing
 * utilities by their order in the stylesheet, not by the order they are
 * written in the attribute, and `w-full` is emitted after every fixed width —
 * so a base that included it would silently swallow the `w-16` a caller adds
 * for a quantity field. `QuietInput` supplies `w-full` for the ordinary
 * full-width case; a sized caller states its own.
 */
export const quietInputCls =
  "rounded-lg border border-transparent bg-neutral-100 px-2.5 py-2 text-sm transition placeholder:text-neutral-400 focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:focus:bg-ink";

export function QuietInput({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full ${quietInputCls} ${className}`} />;
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} ${className}`} />;
}

/** Small uppercase field label — the brand's letter-spaced caption style. */
export function Label({
  children,
  className = "",
  htmlFor,
}: {
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 ${className}`}
    >
      {children}
    </label>
  );
}

/** Same caption style for non-label section headings. */
export function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 ${className}`}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- surfaces */

/** Standard raised card. `pad={false}` when the caller manages its own padding. */
export function Card({
  pad = true,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { pad?: boolean }) {
  return (
    <div
      {...props}
      className={`rounded-xl border border-line bg-white dark:bg-ink-raised ${
        pad ? "p-3 " : ""
      }${className}`}
    />
  );
}

/* --------------------------------------------------------------- sections */

/**
 * Section heading: a short ochre rule, the letter-spaced caption, and an
 * optional trailing slot (a count, a segmented control, a "collapse all").
 *
 * The rule is the design system's ONE ornament — it is what tells you a new
 * group started without spending a heavier type size or a boxed header on it.
 * Use this instead of a bare <SectionLabel> whenever the label introduces a
 * block of content rather than labelling a single field.
 */
export function SectionHeading({
  children,
  trailing,
  className = "",
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-[28px] items-center gap-2.5 ${className}`}>
      <span aria-hidden className="h-0.5 w-5 shrink-0 rounded-full bg-accent" />
      <SectionLabel>{children}</SectionLabel>
      {trailing && <div className="ml-auto shrink-0">{trailing}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- lists */

/**
 * A card whose children are <ListRow>s, divided by hairlines rather than by
 * gaps — the app's standard way to show a list of destinations or records.
 * `overflow-hidden` is what keeps the first/last row's corners inside the card
 * radius, so callers never have to round the rows themselves.
 */
export function ListCard({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <Card pad={false} {...props} className={`overflow-hidden ${className}`} />;
}

/**
 * One row of a <ListCard>: a name, an optional second line, an optional badge,
 * and a chevron when the row goes somewhere.
 *
 * Pass `href` for a link or `onClick` for an in-page action — the row renders
 * as the correct element either way, which is what keeps a tappable row from
 * being a <div> with a click handler (invisible to a keyboard and to a screen
 * reader). Rows are 56px tall so a thumb hits one and not its neighbour.
 */
export function ListRow({
  href,
  onClick,
  label,
  desc,
  badge,
  trailing,
  chevron,
  className = "",
}: {
  href?: string;
  onClick?: () => void;
  label: React.ReactNode;
  desc?: React.ReactNode;
  badge?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Defaults to true for a row that navigates or acts, false for a static one. */
  chevron?: boolean;
  className?: string;
}) {
  const interactive = !!href || !!onClick;
  const showChevron = chevron ?? interactive;
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold tracking-tight">{label}</span>
        {desc && (
          <span className="mt-0.5 block truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
            {desc}
          </span>
        )}
      </span>
      {badge}
      {trailing}
      {showChevron && (
        <span
          aria-hidden
          className="shrink-0 text-lg leading-none text-neutral-300 transition group-hover:text-accent dark:text-neutral-600"
        >
          ›
        </span>
      )}
    </>
  );

  // `group` + border-b/last:border-b-0 give the divided-list look without the
  // caller having to know whether its row is the last one.
  const base = `group flex min-h-[56px] w-full items-center gap-3 border-b border-line-soft px-3 py-2.5 text-left last:border-b-0 ${
    interactive ? "transition hover:bg-accent/5 dark:hover:bg-white/5" : ""
  } ${className}`;

  if (href) {
    return (
      <Link href={href} className={`relative ${base}`}>
        {inner}
        <LinkPendingOverlay spinnerClassName="h-5 w-5" />
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

/* -------------------------------------------------------------- statement */

/**
 * The one figure a page is working toward — the month's total, a balance, a
 * count — set at display size over a heavy ochre rule.
 *
 * Only ONE of these belongs on a page. Its whole job is to be the thing you can
 * read at arm's length, and a second one immediately halves the first one's
 * meaning. `sub` carries the breakdown; `footnote` carries the caveat (what the
 * number excludes, what the other system will actually do with it).
 */
export function StatementBlock({
  label,
  value,
  sub,
  footnote,
  rule = true,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  footnote?: React.ReactNode;
  /** The accent rule above the label. Drop it (`rule={false}`) where the block
   *  already sits under a heading or a header of its own and the second line
   *  reads as a stray divider. */
  rule?: boolean;
  className?: string;
}) {
  return (
    <div className={`${rule ? "border-t-[3px] border-accent pt-3" : ""} ${className}`}>
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-1 text-[32px] font-bold leading-none tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">{sub}</p>}
      {footnote && (
        <p className="mt-2.5 border-l-2 border-line pl-2.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {footnote}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- chips */

export type ChipTone = "neutral" | "warning" | "info" | "success" | "danger" | "accent";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  accent: "bg-accent/15 text-accent dark:text-accent-soft",
};

/**
 * A status mark — draft, No file, invoiced, ✓ Reviewed, over budget.
 *
 * State gets a COLOUR and a shape here rather than a sentence, so a list can be
 * scanned without being read. The semantic tones are deliberately separate from
 * the brand accent: ochre means "this is Ascent", amber/red mean "look at this",
 * and letting the two blur would cost the alert its urgency.
 */
export function Chip({
  tone = "neutral",
  className = "",
  children,
  title,
}: {
  tone?: ChipTone;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CHIP_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** "Something is waiting here" count pill — a badge means queued work, never a total. */
export function CountBadge({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      aria-label={`${n} waiting`}
      className={`shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 ${className}`}
    >
      {n}
    </span>
  );
}

/**
 * A row of quiet, dot-separated facts — "draft · uninvoiced · ✓ saved".
 *
 * The counterpart to `Chip`, and the reason chips can stay rare. A list row
 * that spells out every one of its states as a coloured pill ends up with six
 * or seven of them, and once everything is highlighted nothing is: the two
 * that mean "act on this" get exactly as much attention as "uninvoiced", which
 * is the normal case. So ordinary state reads as plain small text here, and a
 * `Chip` is spent only on the exception — flagged, over budget, unsaved work.
 *
 * Falsy entries are dropped, so callers can build the list inline without
 * filtering it first.
 */
export function MetaLine({
  items,
  className = "",
}: {
  items: React.ReactNode[];
  className?: string;
}) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <span
      className={`flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400 ${className}`}
    >
      {shown.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-neutral-300 dark:text-neutral-600">
              ·
            </span>
          )}
          {item}
        </span>
      ))}
    </span>
  );
}

/**
 * A horizontal, swipeable row — filter chips, headroom cards, anything that is
 * a set you scan sideways rather than a list you scroll down.
 *
 * The negative margin + matching padding is what lets the row bleed to the
 * screen edges inside a padded page, so the last item is visibly cut off and
 * the row reads as scrollable. `bleed` is the page's own horizontal padding.
 */
export function ChipScroller({
  children,
  bleed = "1rem",
  className = "",
}: {
  children: React.ReactNode;
  bleed?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      style={{ marginInline: `-${bleed}`, paddingInline: bleed }}
    >
      {children}
    </div>
  );
}

/** A filter toggle styled as a pill. Filled in the accent when on. */
export function FilterChip({
  on,
  onClick,
  children,
  title,
  className = "",
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-semibold transition ${
        on
          ? "border-accent bg-accent text-accent-fg"
          : "border-line bg-white text-neutral-500 hover:border-accent dark:bg-ink-raised dark:text-neutral-400"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ meters */

/**
 * Budget-usage meter — amber past 90%, red past 100%.
 *
 * The dark track is `white/10`, NOT `neutral-800`: neutral-800 (#262626) sits
 * within a couple of points of the raised card it's drawn on (#23231E), so the
 * unfilled part of every bar was invisible and a bar at 30% read as one at 100%.
 */
export function Meter({
  budget,
  used,
  label,
  className = "mt-0.5 h-1",
}: {
  budget: number;
  used: number;
  label: string;
  className?: string;
}) {
  const pct = budget > 0 ? used / budget : used > 0 ? 1 : 0;
  const over = budget > 0 && used > budget;
  const near = !over && pct >= 0.9;
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10 ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label} budget used`}
    >
      <div
        className={`h-full rounded-full transition-all ${
          over ? "bg-red-500" : near ? "bg-amber-500" : "bg-accent"
        }`}
        style={{ width: `${Math.min(pct, 1) * 100}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------- sticky action bar */

/**
 * The bar that carries a page's commit action (Sync, Save, Post) and pins
 * itself to the bottom of the screen while there is something to commit.
 *
 * It sits ABOVE the tab bar via `--tabbar-h` (see globals.css) rather than a
 * hardcoded offset, so the two can never overlap and neither has to know the
 * other's height. Show it only when there IS a staged change — a permanently
 * docked bar spends the screen's most valuable strip on a disabled button.
 */
export function StickyActionBar({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sticky z-10 -mx-4 flex items-center gap-2 border-t border-line bg-cream/95 px-4 py-2.5 backdrop-blur dark:bg-ink/95 print:hidden ${className}`}
      style={{ bottom: "var(--tabbar-h, 0px)" }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ banners */

export type BannerTone = "error" | "warning" | "success" | "info" | "neutral";

const BANNER_TONE: Record<BannerTone, string> = {
  error: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  info: "bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft",
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export function Banner({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BannerTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg px-4 py-3 text-sm ${BANNER_TONE[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- empty state */

export function EmptyState({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center dark:border-neutral-700 ${className}`}
    >
      <PeakMark className="mx-auto mb-2.5 h-4 w-[26px] opacity-70" color="#8D8D8B" />
      <p className="text-sm text-neutral-500">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ loading */

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-neutral-500">
      <Spinner />
      {label}
    </p>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`animate-pulse rounded bg-neutral-200/70 dark:bg-white/10 ${className}`} />
  );
}

/** Placeholder card list shown while a queue/list loads. */
export function CardSkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          className="rounded-xl border border-line bg-white p-3 dark:bg-ink-raised"
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-2 h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- page header */

/**
 * Standard page header: peak-mark title, optional one-line description, and an
 * optional action slot (buttons/links) that stays top-right at every width.
 * Gives each page the same brand identity whether reached by tab or deep link.
 */
export function PageHeader({
  title,
  titleSlot,
  description,
  actions,
  className = "",
  // A lone button/link never needs to shrink, so shrink-0 is the right default
  // — but a caller with a wider toolbar (many controls) needs it to actually
  // give up space once flex-wrap drops it to its own line below the title,
  // rather than sit at its full unwrapped width and overflow the page.
  actionsClassName = "shrink-0 items-center gap-2",
}: {
  title?: React.ReactNode;
  // A title that draws its OWN heading (peak mark + <h1>) because it is
  // interactive — Tracking Sheets puts the job picker here, so the page name and
  // the control that changes it are one thing. Given a titleSlot, `title` is
  // ignored: the slot owns the <h1>, and nesting one inside another is invalid.
  titleSlot?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  actionsClassName?: string;
}) {
  return (
    <header className={`mb-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {titleSlot ?? <PageTitle className="min-w-0">{title}</PageTitle>}
        {actions && <div className={`flex ${actionsClassName}`}>{actions}</div>}
      </div>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
    </header>
  );
}
