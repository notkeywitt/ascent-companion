// gen-page-map — scan src/app and write src/lib/pageMap.generated.json.
//
// The Admin → Page Map tab draws this file. It holds only what a scan can
// learn: the routes, the redirects, and which page links to or embeds which.
// The tab reads the rest live (workspace, view gate, roles, bar slots) from
// src/lib/workspaces.ts and src/lib/views.ts, so those never go stale.
//
// `npm run build` runs this first (the "prebuild" script), so production
// always draws the current app. Run `npm run gen:pagemap` to refresh by hand.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "src", "app");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "src", "lib", "pageMap.generated.json");

const CODE = /\.tsx?$/;
const isTest = (f) => /\.test\.tsx?$/.test(f);
const LITERAL = /(?<![\w/.:])(["'`])(\/[a-z0-9][a-zA-Z0-9\-_/[\]]*)(\?[^"'`\s${}]*)?/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** "src/app/bill/[docId]/page.tsx" -> "/bill/[docId]". */
function routeOf(file) {
  const rel = relative(APP, dirname(file)).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + rel.join("/");
}

export function buildPageMap() {
  const pageFiles = walk(APP).filter((f) => /[\\/]page\.tsx$/.test(f));
  const pages = pageFiles
    .map((f) => ({ route: routeOf(f), file: relative(ROOT, f).split(sep).join("/") }))
    .sort((a, b) => a.route.localeCompare(b.route));
  const pageDirs = new Map(pageFiles.map((f) => [dirname(f), routeOf(f)]));

  // --- redirects from next.config.mjs
  const cfg = readFileSync(join(ROOT, "next.config.mjs"), "utf8");
  const found = [];
  for (const m of cfg.matchAll(/source:\s*"([^"]+)"[^}]*?destination:\s*"([^"]+)"/g)) {
    found.push({ from: m[1].replace(/\/:[a-z]+\*$/, ""), to: m[2] });
  }
  const arr = cfg.match(/\.\.\.\[((?:\s*"\/[^"]*",?)+)\s*\]\.map/);
  if (arr) for (const m of arr[1].matchAll(/"(\/[^"]*)"/g)) found.push({ from: m[1], to: "/" });
  const seen = new Set();
  const redirects = found.filter((r) => {
    const k = r.from + ">" + r.to;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const redirectFrom = new Set(redirects.map((r) => r.from));

  // --- route matching for a literal path
  const matchers = pages.map((p) => ({
    route: p.route,
    dynamic: p.route.includes("["),
    re: new RegExp(
      "^" +
        p.route
          .split("/")
          .map((s) =>
            /^\[\.\.\..*\]$/.test(s) ? ".+" : /^\[.*\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"),
          )
          .join("/") +
        "$",
    ),
  }));
  function resolveRoute(path) {
    const clean = path.replace(/\/+$/, "") || "/";
    for (const m of matchers) if (!m.dynamic && m.route === clean) return m.route;
    for (const m of matchers) if (m.dynamic && m.re.test(clean)) return m.route;
    // a template literal's static head, like `/bill/${id}`
    for (const m of matchers) {
      const head = m.route.split("[")[0].replace(/\/$/, "");
      if (m.dynamic && head && clean === head) return m.route;
    }
    if (redirectFrom.has(clean)) return clean; // a link into a redirect
    return null;
  }

  // --- imports
  function resolveImport(from, spec) {
    let base;
    if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null;
    for (const c of [base + ".tsx", base + ".ts", join(base, "index.tsx"), join(base, "index.ts")]) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  }
  const ownerRoute = (file) => {
    let d = dirname(file);
    while (d.startsWith(APP)) {
      if (pageDirs.has(d)) return pageDirs.get(d);
      d = dirname(d);
    }
    return null;
  };

  const links = new Map();
  const embeds = new Set();
  const RANK = { link: 0, push: 1, redirect: 2, strip: 3 };
  // A tab row that joins separate routes: each tab looks like a tab but opens its own page.
  const STRIP = /(PageTabs|JobTabs|ToolsTabs|InvoicingTabs)\.tsx$/;
  const add = (from, to, kind, q) => {
    if (from === to) return;
    const k = from + ">" + to;
    const e = links.get(k) ?? { from, to, kind, q: new Set() };
    if (RANK[kind] > RANK[e.kind]) e.kind = kind;
    if (q) e.q.add(q);
    links.set(k, e);
  };
  function scan(from, src, file) {
    if (STRIP.test(file)) {
      // A strip file can hold several tab sets (PageTabs does). Only the set that
      // holds this page is its strip.
      for (const blk of src.matchAll(/=\s*(?:\w+\s*)?\[([\s\S]*?)\n\];?/g)) {
        const routes = new Set();
        for (const m of blk[1].matchAll(/href:\s*["'`](\/[^"'`?]*)/g)) {
          const r = resolveRoute(m[1]);
          if (r) routes.add(r);
        }
        if (!routes.has(from)) continue;
        for (const to of routes) add(from, to, "strip", "");
      }
      return;
    }
    for (const m of src.matchAll(LITERAL)) {
      const path = m[2];
      if (path.startsWith("/api/") || path.startsWith("/_next")) continue;
      const to = resolveRoute(path);
      if (!to) continue;
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      const kind = STRIP.test(file)
        ? "strip"
        : /redirect\(\s*$/i.test(before)
          ? "redirect"
          : /(push|replace)\(\s*$/.test(before)
            ? "push"
            : "link";
      const q = m[3] ? m[3].replace(/^\?/, "").split("&")[0] : "";
      add(from, to, kind, /^(section|tab)=\w+$/.test(q) ? q : "");
    }
  }

  for (const p of pages) {
    const start = join(ROOT, p.file);
    const dir = dirname(start);
    const seenFiles = new Set();
    const queue = [[start, 0]];
    // The page's own folder (minus nested pages' folders), then what it imports.
    for (const f of walk(dir)) {
      if (CODE.test(f) && !isTest(f) && f !== start && ownerRoute(f) === p.route) queue.push([f, 1]);
    }
    while (queue.length) {
      const [file, depth] = queue.shift();
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      const src = readFileSync(file, "utf8");
      scan(p.route, src, file);
      if (depth >= 3) continue;
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const target = resolveImport(file, m[1]);
        if (!target || target.startsWith(join(SRC, "lib"))) continue;
        const owner = ownerRoute(target);
        if (owner && owner !== p.route) {
          embeds.add(p.route + ">" + owner); // another page's component is drawn inside this one
          continue;
        }
        queue.push([target, depth + 1]);
      }
    }
  }

  return {
    pages,
    redirects: redirects.sort((a, b) => a.from.localeCompare(b.from)),
    links: [...links.values()]
      .map((e) => ({ from: e.from, to: e.to, kind: e.kind, ...(e.q.size ? { q: [...e.q].sort() } : {}) }))
      .sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to)),
    embeds: [...embeds].sort().map((s) => {
      const [from, to] = s.split(">");
      return { from, to };
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const map = buildPageMap();
  writeFileSync(OUT, JSON.stringify(map, null, 1) + "\n");
  console.log(
    `page map: ${map.pages.length} pages, ${map.links.length} links, ${map.embeds.length} embeds, ${map.redirects.length} redirects`,
  );
}
