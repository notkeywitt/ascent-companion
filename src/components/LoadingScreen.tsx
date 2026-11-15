import { UpdateNotice } from "@/components/UpdateNotice";

/** One loop of the line: draw, hold, erase, rest. The keyframes in globals.css
 *  (`loading-line-wipe` / `loading-line-hold`) set the phases as percentages of
 *  this; `LINE_ERASE_END` is where the erase finishes. Change both together. */
export const LINE_CYCLE_MS = 2400;
export const LINE_ERASE_END = 0.84;

/** The brand peak, copied from AscentLogo.tsx (1080 viewBox). Keep exact. Drawn
 *  as its ridge only: right base, right peak, notch, left peak, left base. */
const RIDGE = "809,710 582.362,373 472.75,442.506 439.919,418.811 271,710";

/**
 * The app's one loading screen: a single line on the THEME's own ground. It
 * enters at the right edge, level with the centre of the screen, rises over
 * the Ascent peak, runs out the left edge, holds, then erases right to left.
 * It loops while the wait lasts. The ground is the same colour as <body>, so
 * when the cover clears there is no colour change, only the page arriving.
 *
 * Three things render it —
 *   • `SplashScreen` — the app-open cover (see that file).
 *   • `RouteLoadingScreen` — an in-app tap, from the tap to the next page.
 *   • `src/app/loading.tsx` — the App Router's Suspense fallback, which covers
 *     the hard loads (a typed URL, a refresh, a cold PWA start).
 * The last two pass `delayed`: the cover and the line both wait 400ms, so a
 * fast page swap shows nothing, and a slow one starts the line from the edge.
 *
 * WHY it moves by transform, not by drawing the stroke: the line is drawn in
 * full and revealed by a sweep. `loading-line-wipe` slides a clipping layer
 * and `loading-line-hold` slides its content back the same distance, so the
 * line stays put while the visible edge travels. Transform runs on the GPU
 * (compositor), so the line keeps moving while a phone's main thread is busy
 * starting the app — a stroke-dash animation would stall right then. The
 * ridge only ever moves right to left, so the sweep traces it exactly as a pen
 * would. The two tails are flex boxes, so the line spans any screen with no JS.
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
  const late = delayed ? " loading-line-late" : "";
  const timing = { animationDuration: `${LINE_CYCLE_MS}ms` };
  return (
    <div
      role="status"
      aria-label="Loading"
      style={style}
      className={`pointer-events-none fixed inset-0 z-[100] overflow-hidden bg-cream text-offblack dark:bg-ink dark:text-white ${
        delayed ? "loading-screen-in" : ""
      } ${className}`}
    >
      <div className={`loading-line-wipe absolute inset-0 overflow-hidden${late}`} style={timing}>
        <div className={`loading-line-hold absolute inset-0${late}`} style={timing}>
          {/* The row's bottom edge is the mountain's base, on the centre line. */}
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-full items-end">
            <span className="loading-line-tail flex-1" />
            <svg
              viewBox="271 373 538 337"
              preserveAspectRatio="xMidYMax meet"
              aria-hidden="true"
              className="h-[35px] w-[56px] shrink-0 overflow-visible"
            >
              <polyline
                points={RIDGE}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span className="loading-line-tail flex-1" />
          </div>
        </div>
      </div>
      {/* The first load after a deploy can be slow; this says why. */}
      <div className="absolute inset-x-0 top-[calc(50%+3rem)] flex justify-center">
        <UpdateNotice />
      </div>
    </div>
  );
}
