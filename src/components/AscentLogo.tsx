/**
 * Ascent Building Co. primary logo lockup (Brand Guidelines, May 2024):
 * the icon square next to the wordmark, equal in height and visual weight.
 *
 * The mountain icon is drawn inline as SVG so it stays crisp at any size (the
 * guide allows the icon down to 20px) and reads correctly in both themes. The
 * square follows the theme's brand hue — OCHRE in light, brand OLIVE in dark —
 * so each theme stays on one pairing (page 17's olive-backed icon is the dark
 * variant). The wordmark is off-black on light / cream on dark (both AA-safe
 * per the type-pairing page).
 */
export function AscentLogo({
  wordmark = true,
  className = "",
}: {
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={"inline-flex items-center gap-2 " + className}>
      <AscentIcon className="h-7 w-7 shrink-0 rounded-[3px]" />
      {wordmark && (
        <span className="flex flex-col justify-center leading-[0.95] tracking-[0.14em]">
          <span className="text-[13px] font-medium text-offblack dark:text-cream">ASCENT</span>
          <span className="text-[13px] font-medium text-offblack dark:text-cream">
            BUILDING CO.
          </span>
        </span>
      )}
    </span>
  );
}

/** The bare icon: brand-hue square with the mountain mark knocked out of it. */
export function AscentIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Ascent Building Co." className={className}>
      <rect width="100" height="100" className="fill-brand" />
      {/* Notched double-peak mountain, knocked out in the square's counterpart:
          off-black out of light-theme ochre, cream out of dark-theme olive. */}
      <polygon points="18,74 40,41 46,47 56,30 82,74" className="fill-brand-fg" />
    </svg>
  );
}
