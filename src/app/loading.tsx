/**
 * The App Router's Suspense fallback for a HARD load: a typed URL, a refresh,
 * a cold PWA start. It paints nothing of its own. It is a marker that says
 * "the page is still streaming in".
 *
 * WHY no cover here: a Suspense fallback is removed the instant the page
 * arrives, so a cover drawn here would clear mid-stroke and show a snip of the
 * line. The app-open cover (`SplashScreen`) is already on screen during every
 * hard load. It reads this marker and keeps looping its line while the marker
 * is present, then clears at the end of an erase.
 *
 * An in-app tap does NOT reach here — React runs that navigation as a
 * transition and keeps the current page on screen. `RouteLoadingScreen`
 * covers those.
 */
export default function Loading() {
  return <div data-page-streaming="" hidden />;
}
