/**
 * Ascent Building Co. primary logo lockup (Brand Guidelines, May 2024):
 * the icon square next to the wordmark, equal in height and visual weight.
 *
 * The mountain icon is drawn inline as SVG so it stays crisp at any size (the
 * guide allows the icon down to 20px) and reads correctly in both themes. Its
 * square is `brand` and its knocked-out peak is `accent-fg` — the same pair
 * every filled accent in the app uses, so the mark is right in any palette
 * without this file knowing a colour. Under the Guidelines palette that
 * resolves to p.17's pairing, an ochre square with an off-black peak at
 * 6.70:1; under the Website palette it is black-on-cream, or white-on-black in
 * the dark. The wordmark is off-black on light / cream on dark (both AA-safe
 * per the type-pairing page).
 *
 * `tone="white"` is the single-color REVERSED lockup: white square, peak
 * knocked out in black, white wordmark. It ignores the theme, for use on a
 * dark photo or a black ground. Nothing renders it today — the loading screen
 * did, until that screen took the theme's own ground — but it is the guide's
 * inverse lockup and is kept for the next surface that needs one.
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
          knockout is `accent-fg` — the token for "the label ON a filled brand
          shape" — so it tracks the square instead of naming a colour. That is
          what keeps it legible when a palette makes the square black or white:
          hardcoding off-black here painted a near-invisible peak on a black
          square. The reversed lockup is its own fixed pair, black on white. */}
      {white ? (
        <polygon points="18,74 40,41 46,47 56,30 82,74" fill="#000000" />
      ) : (
        <polygon points="18,74 40,41 46,47 56,30 82,74" className="fill-accent-fg" />
      )}
    </svg>
  );
}
