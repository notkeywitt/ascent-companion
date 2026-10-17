/**
 * The arithmetic behind pull-to-refresh (src/components/PullToRefresh.tsx),
 * kept apart from the touch handling so it can be tested.
 */

/** How far, in px, the indicator travels before a release reloads the page. */
export const PULL_THRESHOLD = 72;

/** The indicator never travels further than this, however far the finger goes. */
export const PULL_MAX = 110;

/**
 * Finger travel → indicator travel. Half-rate, so the pull feels weighted, and
 * capped at PULL_MAX. An upward or zero move is no pull at all.
 */
export function pullDistance(fingerDy: number): number {
  if (fingerDy <= 0) return 0;
  return Math.min(PULL_MAX, fingerDy * 0.5);
}

/** True when a release at this indicator travel should reload the page. */
export function pullArmed(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}
