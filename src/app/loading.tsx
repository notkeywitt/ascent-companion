import { LoadingScreen } from "@/components/LoadingScreen";

/**
 * The loading screen for a HARD load: a typed URL, a refresh, a cold PWA
 * start. The App Router wraps the root layout's children in a Suspense
 * boundary with this as the fallback, so the brand cover holds the screen
 * while the page streams in.
 *
 * An in-app tap does NOT reach here — React runs that navigation as a
 * transition and keeps the current page on screen rather than falling back.
 * `RouteLoadingScreen` covers those.
 *
 * `delayed` keeps a fast load silent — the cover only fades in once the wait
 * is long enough to be worth showing.
 */
export default function Loading() {
  return <LoadingScreen delayed />;
}
