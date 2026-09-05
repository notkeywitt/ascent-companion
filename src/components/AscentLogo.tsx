/**
 * Ascent Building Co. primary logo lockup (Brand Guidelines, May 2024):
 * the icon square next to the wordmark, equal in height and visual weight.
 *
 * The mountain icon is drawn inline as SVG so it stays crisp at any size (the
 * guide allows the icon down to 20px) and reads correctly in both themes. The
 * square follows the theme's brand hue — OCHRE in light, brand OLIVE in dark.
 * It stays olive in dark even though the interactive accent there is now ochre:
 * page 17 sanctions the olive square with a cream peak, and it keeps olive in
 * the frame as the usage ratios on p.14 intend. The wordmark is off-black on
 * light / cream on dark (both AA-safe per the type-pairing page).
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
      {/* Notched double-peak mountain, always knocked out in cream — never dark.
          The mark reads as a light peak on the brand square in BOTH themes; a
          dark knockout on ochre is off-brand (guide p.17 shows it light-out).
          The reversed lockup inverts the pair, so the peak goes black there. */}
      <polygon points="18,74 40,41 46,47 56,30 82,74" fill={white ? "#000000" : "#FAF7EE"} />
    </svg>
  );
}
