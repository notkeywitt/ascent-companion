/**
 * Page heading with the Ascent "peak" mark — carries the logo motif into the
 * page bodies as a consistent brand signature. The mark is the theme's brand
 * hue (ochre in light, olive in dark); it's purely decorative (the <h1> carries
 * the name), so the low brand-on-surface contrast that fails for text is fine.
 * Callers may override with any CSS color (EmptyState uses webgrey).
 */
export function PeakMark({
  className = "",
  color = "rgb(var(--brand))",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <svg viewBox="0 0 100 62" aria-hidden="true" className={className} style={{ fill: color }}>
      <polygon points="6,60 34,15 42,24 54,2 94,60" />
    </svg>
  );
}

export function PageTitle({
  children,
  size = "xl",
  className = "",
}: {
  children: React.ReactNode;
  size?: "xl" | "2xl";
  className?: string;
}) {
  return (
    <div className={"flex items-center gap-2.5 " + className}>
      <PeakMark className={size === "2xl" ? "h-4 w-[26px] shrink-0" : "h-3.5 w-[22px] shrink-0"} />
      <h1 className={(size === "2xl" ? "text-2xl" : "text-xl") + " font-bold tracking-tight"}>
        {children}
      </h1>
    </div>
  );
}
