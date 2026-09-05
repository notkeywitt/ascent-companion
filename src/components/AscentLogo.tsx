/**
 * Ascent Building Co. primary logo lockup (Brand Guidelines, May 2024):
 * the icon square next to the wordmark, equal in height and visual weight.
 *
 * The mountain icon is drawn inline as SVG so it stays crisp at any size (the
 * guide allows the icon down to 20px) and reads correctly in both themes. The
 * square is brand OCHRE in both themes with the peak knocked out in off-black —
 * p.17's ochre pairing, 6.70:1. The mark does not change color when the theme
 * flips; only the ground behind it does. The wordmark is off-black on light /
 * cream on dark (both AA-safe per the type-pairing page).
 *
 * `tone="white"` is the single-color REVERSED lockup: white square, peak
 * knocked out in black, white wordmark. It is for a black ground only — the
 * loading screen — and ignores the theme, because that ground is black in
 * both themes.
 */
export type LogoTone = "brand" | "white";

export function AscentLogo({
  wordmark = true,
  tone = "brand",
  size = "sm",
  className = "",
}: {
  wordmark?: boolean;
  tone?: LogoTone;
  /** `sm` is the header lockup; `lg` is the loading screen. */
  size?: "sm" | "lg";
  className?: string;
}) {
  const large = size === "lg";
  const word =
    (large ? "text-[17px] " : "text-[13px] ") +
    (tone === "white" ? "font-medium text-white" : "font-medium text-offblack dark:text-cream");
  return (
    <span className={`inline-flex items-center ${large ? "gap-3" : "gap-2"} ${className}`}>
      <AscentIcon
        tone={tone}
        className={large ? "h-16 w-16 shrink-0 rounded-[6px]" : "h-7 w-7 shrink-0 rounded-[3px]"}
      />
      {wordmark && (
        <span
          className={`flex flex-col justify-center leading-[0.95] ${large ? "tracking-[0.18em]" : "tracking-[0.14em]"}`}
        >
          <span className={word}>ASCENT</span>
          <span className={word}>BUILDING CO.</span>
        </span>
      )}
    </span>
  );
}

/** The bare icon: brand-hue square with the mountain mark knocked out of it. */
export function AscentIcon({
  tone = "brand",
  className = "",
}: {
  tone?: LogoTone;
  className?: string;
}) {
  const white = tone === "white";
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Ascent Building Co." className={className}>
      {white ? (
        <rect width="100" height="100" fill="#FFFFFF" />
      ) : (
        <rect width="100" height="100" className="fill-brand" />
      )}
      {/* Notched double-peak mountain, knocked out of the brand square. The
          square is ochre in BOTH themes, and p.17 pairs an ochre square with an
          OFF-BLACK peak — so the knockout is off-black in both, at 6.70:1. It
          is never cream: cream on ochre is the 2.41:1 pairing p.16 restricts.
          The reversed lockup is its own pair: black peak on a white square. */}
      <polygon points="18,74 40,41 46,47 56,30 82,74" fill={white ? "#000000" : "#1B1B17"} />
    </svg>
  );
}
