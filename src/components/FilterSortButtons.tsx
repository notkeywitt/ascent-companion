"use client";

/**
 * The Filter and Sort icon buttons the Bills list (src/app/bills) uses, for a
 * header that folds its filters and its sort / group switch behind them.
 * `count` is how many filters are set away from their defaults.
 */
const base =
  "relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control border px-2 lg:min-h-8 lg:min-w-8";

const edge = (open: boolean) =>
  open ? "border-neutral-900 dark:border-white" : "border-neutral-200 dark:border-white/10";

const svgProps = {
  viewBox: "0 0 24 24",
  className: "h-5 w-5 lg:h-4 lg:w-4",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function FilterIconButton({
  open,
  onClick,
  label,
  count = 0,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      title={label}
      className={`${base} ${edge(open)}`}
    >
      <svg {...svgProps}>
        <path d="M3 5h18l-7 8v6l-4 2v-8z" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-900 px-1 text-xs font-bold text-white dark:bg-white dark:text-neutral-900">
          {count}
        </span>
      )}
    </button>
  );
}

export function SortIconButton({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      title={label}
      className={`${base} ${edge(open)}`}
    >
      <svg {...svgProps}>
        <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
      </svg>
    </button>
  );
}
