/**
 * Which page did a deploy edit most? Pure rules, no I/O, so a test can pin them.
 *
 * Plain .mjs because next.config.mjs runs this at build time and cannot import
 * TypeScript; the app imports it too (allowJs).
 *
 * The build freezes the last few commits as `[{ sha, pages: { "/payments": 42 } }]`
 * (newest first) into APP_BUILD_CHANGES. A tab knows only its own build's sha, so
 * `/api/version` adds up the commits NEWER than that sha and names the top page.
 * Only files under `src/app/` count: a page folder, or a route folder whose page
 * exists. An edit to a shared component maps to no page.
 */

/** How many recent commits the build records. A tab further behind gets no page. */
export const CHANGE_DEPTH = 10;

/**
 * `git log -n N --no-renames --format=@%H --numstat` → [{ sha, files: [[path, lines]] }].
 * `lines` is insertions + deletions; a binary file (`-`) counts 1.
 */
export function parseNumstatLog(text) {
  const commits = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith("@")) {
      commits.push({ sha: line.slice(1), files: [] });
      continue;
    }
    const cur = commits[commits.length - 1];
    if (!cur) continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const n = (m[1] === "-" ? 0 : Number(m[1])) + (m[2] === "-" ? 0 : Number(m[2]));
    cur.files.push([m[3], n || 1]);
  }
  return commits;
}

/**
 * The page routes that exist, from the paths of every `page.*` file under
 * src/app (relative, e.g. "payments/page.tsx"). Route groups "(x)" drop out of
 * the URL; a dynamic folder "[id]" has no fixed URL, so its page is skipped.
 */
export function pageRoutesFrom(pageFiles) {
  const routes = new Set();
  for (const f of pageFiles) {
    const segs = f.split("/").slice(0, -1).filter((s) => !(s.startsWith("(") && s.endsWith(")")));
    if (segs.some((s) => s.startsWith("["))) continue;
    routes.add("/" + segs.join("/"));
  }
  return routes;
}

/** The page a changed file belongs to, or null. `routes` is from pageRoutesFrom. */
export function routeForFile(file, routes) {
  if (!file.startsWith("src/app/")) return null;
  const parts = file.slice("src/app/".length).split("/");
  const name = parts.pop() || "";
  let segs = parts.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  if (segs[0] === "api") segs = segs.slice(1);
  const dyn = segs.findIndex((s) => s.startsWith("["));
  if (dyn >= 0) segs = segs.slice(0, dyn);
  // The root page is Home. Nothing else directly under src/app is a page's own.
  if (segs.length === 0) return /^page\./.test(name) && parts.length === 0 && routes.has("/") ? "/" : null;
  while (segs.length > 0 && !routes.has("/" + segs.join("/"))) segs.pop();
  return segs.length > 0 ? "/" + segs.join("/") : null;
}

/** Lines changed per page for one commit's files. */
export function pageWeights(files, routes) {
  const out = {};
  for (const [file, n] of files) {
    const r = routeForFile(file, routes);
    if (r) out[r] = (out[r] || 0) + n;
  }
  return out;
}

/** The frozen value: newest-first `[{ sha, pages }]`, commits with no page edit kept. */
export function buildChangeList(log, routes) {
  return parseNumstatLog(log).map((c) => ({ sha: c.sha, pages: pageWeights(c.files, routes) }));
}

/**
 * The page with the most edits in the commits newer than `since` (the tab's
 * build). Null when `since` is not in the list (too far behind, or a shallow
 * clone), when `since` is the newest commit, or when no page was edited.
 * A tie goes to the shorter route, then alphabetical, so the answer is stable.
 */
export function topPageSince(changes, since) {
  if (!since || !Array.isArray(changes)) return null;
  const at = changes.findIndex((c) => c && c.sha === since);
  if (at <= 0) return null;
  const total = {};
  for (const c of changes.slice(0, at)) {
    for (const [route, n] of Object.entries(c.pages || {})) total[route] = (total[route] || 0) + n;
  }
  const ranked = Object.entries(total).sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]),
  );
  return ranked.length > 0 ? ranked[0][0] : null;
}
