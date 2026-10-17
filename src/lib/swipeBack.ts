/**
 * The arithmetic behind swipe-to-go-back (src/components/SwipeBack.tsx), kept
 * apart from the touch handling so it can be tested.
 */

/** A swipe must START this close to the screen's left edge, in px. */
export const SWIPE_EDGE = 32;

/** How far, in px, the finger must travel right before a release goes back. */
export const SWIPE_THRESHOLD = 80;

/** True when a touch at this x may start a back swipe. */
export function swipeStarts(startX: number): boolean {
  return startX <= SWIPE_EDGE;
}

/**
 * True when the finger has moved like a back swipe: rightward, far enough, and
 * mostly sideways (vertical travel under half the horizontal), so a scroll
 * that drifts right does not count.
 */
export function swipeArmed(dx: number, dy: number): boolean {
  return dx >= SWIPE_THRESHOLD && Math.abs(dy) < dx * 0.5;
}
