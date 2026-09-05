import { AscentLogo } from "@/components/AscentLogo";

/**
 * The app's one loading screen: the Ascent lockup on the THEME's own ground,
 * filling the viewport. It is deliberately the same colour as <body> — the
 * cover and the app underneath it are one surface, so when it clears there is
 * no colour change to see, only the page arriving. Three things render it —
 *
 *   • `SplashScreen` — the app-open cover (see that file).
 *   • `RouteLoadingScreen` — an in-app tap, from the tap to the next page.
 *   • `src/app/loading.tsx` — the App Router's Suspense fallback, which covers
 *     the hard loads (a typed URL, a refresh, a cold PWA start).
 *
 * The last two pass `delayed`, so a page swap the eye never sees stays
 * invisible instead of flashing black.
 *
 * It is `pointer-events-none` on purpose: it hides the page underneath but
 * never traps the user, so the header and tab bar still take a tap while a
 * slow page loads.
 */
export function LoadingScreen({
  delayed = false,
  className = "",
  style,
}: {
  /** Fade in after a beat instead of painting at once (route transitions). */
  delayed?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={style}
      className={`pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-cream dark:bg-ink ${
        delayed ? "loading-screen-in" : ""
      } ${className}`}
    >
      <AscentLogo size="lg" />
    </div>
  );
}
