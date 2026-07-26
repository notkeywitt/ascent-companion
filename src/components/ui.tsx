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

import { PageTitle, PeakMark } from "@/components/PageTitle";

/* ------------------------------------------------------------------ buttons */

export type BtnVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type BtnSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

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
      className={`mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500 ${className}`}
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
      className={`text-[11px] font-semibold uppercase tracking-wide text-neutral-500 ${className}`}
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
      className={`rounded-xl border border-neutral-200 bg-white dark:border-neutral-700/60 dark:bg-ink-raised ${
        pad ? "p-3 " : ""
      }${className}`}
    />
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

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-accent dark:border-neutral-600 dark:border-t-accent ${className}`}
    />
  );
}

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
          className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised"
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
  description,
  actions,
  className = "",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <PageTitle className="min-w-0">{title}</PageTitle>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
    </header>
  );
}
