import { UpdateNotice } from "@/components/UpdateNotice";

/** One loop of the line: draw, hold, erase, rest. The keyframes in globals.css
 *  (`loading-line-wipe` / `loading-line-hold`) set the phases as percentages of
 *  this; `LINE_ERASE_END` is where the erase finishes. Change both together. */
export const LINE_CYCLE_MS = 2400;
/** The page-change line: twice the speed, with a stronger ease in and out. */
export const LINE_FAST_CYCLE_MS = 1200;
export const LINE_ERASE_END = 0.84;

/**
 * Milliseconds until the line inside `root` finishes its current erase. 0 when
 * the line is resting between loops (the screen is empty ground). null when
 * the line has not started yet (still inside its 400ms delay) or does not move
 * (reduced motion): there is no stroke on screen to finish.
 */
export function msToEraseEnd(root: Element | null, cycleMs: number): number | null {
  const anim = root?.querySelector(".loading-line-wipe")?.getAnimations?.()[0];
  const now = anim?.currentTime;
  if (!anim || typeof now !== "number") return null;
  const delay = Number(anim.effect?.getTiming().delay ?? 0);
  const t = now - delay;
  if (t < 0) return null;
  const into = t % cycleMs;
  const end = cycleMs * LINE_ERASE_END;
  return into <= end ? end - into : 0;
}

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
 * Two things render it —
 *   • `SplashScreen` — the app-open cover, at normal speed. It also covers a
 *     hard load's streaming page (see that file and `src/app/loading.tsx`).
 *   • `RouteLoadingScreen` — an in-app tap, at `fast` speed. It passes
 *     `delayed`: the cover and the line both wait 400ms, so a fast page swap
 *     shows nothing, and a slow one starts the line from the edge.
 * Both covers play the line whole or not at all: they never clear mid-stroke
 * (`msToEraseEnd`).
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
  fast = false,
  className = "",
  style,
}: {
  /** Twice the speed with a stronger ease (page changes). */
  fast?: boolean;
  /** Fade in after a beat instead of painting at once (route transitions). */
  delayed?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const late = (delayed ? " loading-line-late" : "") + (fast ? " loading-line-fast" : "");
  const timing = { animationDuration: `${fast ? LINE_FAST_CYCLE_MS : LINE_CYCLE_MS}ms` };
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
