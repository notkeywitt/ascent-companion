/**
 * Ascent Building Co. primary logo lockup (Brand Guidelines, May 2024):
 * the icon square next to the wordmark, equal in height and visual weight.
 *
 * The mountain icon is drawn inline as SVG so it stays crisp at any size (the
 * guide allows the icon down to 20px) and reads correctly in both themes. The
 * square uses brand OLIVE — page 17 shows the olive-backed icon passing AA on
 * both cream and off-black, so one variant works light and dark. The wordmark
 * is off-black on light / cream on dark (both AA-safe per the type-pairing page).
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

/** The bare icon: olive square with the knocked-out cream mountain mark. */
export function AscentIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Ascent Building Co." className={className}>
      <rect width="100" height="100" fill="#878054" />
      {/* Notched double-peak mountain, knocked out in cream. */}
      <polygon points="18,74 40,41 46,47 56,30 82,74" fill="#FAF7EE" />
    </svg>
  );
}
