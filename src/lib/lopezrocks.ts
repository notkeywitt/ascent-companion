import { unstable_cache } from "next/cache";

import { LR_ORIGIN, LrNotAPage, parseLopezRocks, upstreamPath, type LrLink, type LrParsed } from "@/lib/lopezrocksParse";

/**
 * LopezRocks pages for /lopezrocks — the fetch and the cache. Server only.
 * The reading of a page is `src/lib/lopezrocksParse.ts`.
 *
 * ONE REQUEST PER PAGE PER 15 MINUTES, however many people are reading. The
 * parsed page sits in Next's Data Cache, which every lambda shares, so a team
 * of phones costs LopezRocks about what one visitor costs it. After 15 minutes
 * the next reader still gets the stored copy at once, and a fresh one is
 * fetched behind it.
 *
 * THE FIREWALL. LopezRocks sits behind a Sucuri firewall that answers some
 * requests from a server with a "checking your browser" page, or drops the
 * connection (2 of 10 in a test on 2026-09-27). Neither is stored: the fetch
 * throws, and a throw never enters the cache — so a page read once keeps
 * showing, and a page never read yet shows a "try again" notice. The reader
 * never tries to get past the check, and the request says who is asking
 * (USER_AGENT), because the site is a small not-for-profit that owes the app
 * nothing.
 */

const USER_AGENT =
  "AscentAssistant/1.0 (LopezRocks reader for Ascent Building Co. staff; +https://www.ascentbuildingco.com)";

// A phone is waiting on this, and the site answers in well under a second
// when it answers at all.
const TIMEOUT_MS = 8000;

async function load(path: string): Promise<LrParsed> {
  const started = Date.now();
  const res = await fetch(`${LR_ORIGIN}/${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    cache: "no-store", // the parsed page is cached below, not the raw HTML
    redirect: "manual", // the firewall's check arrives as a redirect
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  console.info(`[lopezrocks] ${path} ${res.status} ${Date.now() - started}ms`);
  if (res.status !== 200) throw new LrNotAPage(`LopezRocks answered ${res.status}`);
  return parseLopezRocks(await res.text());
}

// Bump the version whenever the parsed shape changes, so a deploy never draws
// a page from a copy the old parser made.
const cachedLoad = unstable_cache(load, ["lopezrocks-page-v2"], { revalidate: 900 });

export type LopezRocksResult =
  | { ok: true; data: LrParsed }
  /** blocked: the firewall's check, or a page that is not LopezRocks'. */
  | { ok: false; reason: "blocked" | "timeout" | "error" };

/** One LopezRocks page, parsed — or why it could not be read this time. */
export async function getLopezRocksPage(link: LrLink): Promise<LopezRocksResult> {
  const path = upstreamPath(link);
  if (!path) return { ok: false, reason: "error" };
  try {
    return { ok: true, data: await cachedLoad(path) };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "LrNotAPage") return { ok: false, reason: "blocked" };
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, reason: "timeout" };
    console.error("[lopezrocks]", path, err);
    return { ok: false, reason: "error" };
  }
}
