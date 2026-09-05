import { AscentLogo } from "@/components/AscentLogo";

/**
 * The app's one loading screen: the reversed Ascent lockup on black, filling
 * the viewport. Three things render it —
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
}: {
  /** Fade in after ~180ms instead of painting at once (route transitions). */
  delayed?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black ${
        delayed ? "loading-screen-in" : ""
      } ${className}`}
    >
      <AscentLogo tone="white" size="lg" />
    </div>
  );
}
