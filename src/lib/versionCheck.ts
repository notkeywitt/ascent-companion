/**
 * Is the server running a different build than this tab? (the "update ready"
 * banner). Pure, so a test can pin it. A blank on either side means "unknown",
 * and unknown never raises the banner: a local build with no git stamp must not
 * nag.
 */
export function isNewBuildLive(running: string, live: unknown): boolean {
  if (!running || typeof live !== "string" || !live) return false;
  return running !== live;
}
