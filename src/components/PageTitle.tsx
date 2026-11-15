import { HeaderTitle } from "@/components/HeaderTitle";

/**
 * Page heading with the Ascent "peak" mark — carries the logo motif into the
 * page bodies as a consistent brand signature. The mark is brand ochre in both
 * themes (guide p.17 sanctions it on cream and on off-black alike), so the
 * signature doesn't change color when the theme flips. It's purely decorative —
 * the <h1> carries the name.
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
  // On a phone the title lives in the header bar (HeaderTitle); the page's own
  // heading shows from `pad` up. The header's logo is the page's one mountain.
  return (
    <>
      <HeaderTitle>{children}</HeaderTitle>
      <div className={"hidden items-center pad:flex " + className}>
        <h1 className={(size === "2xl" ? "text-2xl" : "text-xl") + " font-bold tracking-tight"}>
          {children}
        </h1>
      </div>
    </>
  );
}
