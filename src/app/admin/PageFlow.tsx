"use client";

import { useMemo, useState } from "react";

import type { Row } from "./PageMapPanel";

/**
 * The Page Map as a left-to-right tree: Home, then each workspace, then its
 * pages, then the pages each one opens that no menu reaches (a hub's sections,
 * a job's tabs). A page sits under the nearest parent: a workspace for a menu
 * row, else the page that draws it or links to it. Pages nothing reaches hang
 * under "No way in". Selecting a page draws its other links across the tree.
 */

interface Edge {
  from: string;
  to: string;
}
interface N {
  id: string;
  label: string;
  color: string;
  route?: string;
  kind: "root" | "ws" | "page" | "group";
  kids: N[];
  depth: number;
  y: number;
}

const W = 196;
const H = 24;
const GX = 56;
const ROW = 30;
const PAD = 12;

export function PageFlow({
  rows,
  workspaces,
  links,
  embeds,
  colorOf,
  match,
  sel,
  setSel,
}: {
  rows: Row[];
  workspaces: { id: string; title: string; color: string }[];
  links: Edge[];
  embeds: Edge[];
  colorOf: (route: string) => string;
  match: (r: Row) => boolean;
  sel: string | null;
  setSel: (route: string | null) => void;
}) {
  const [shut, setShut] = useState<Set<string>>(new Set());

  const root = useMemo(() => {
    const byRoute = new Map(rows.map((r) => [r.route, r]));
    const node = (r: Row): N => ({ id: r.route, route: r.route, label: r.label, color: colorOf(r.route), kind: "page", kids: [], depth: 0, y: 0 });
    const nodes = new Map<string, N>();
    for (const r of rows) nodes.set(r.route, node(r));

    const home = nodes.get("/");
    const top: N = home ?? { id: "root", label: "Home", color: "var(--viz-other)", kind: "root", kids: [], depth: 0, y: 0 };
    const wsNodes = new Map<string, N>();
    for (const w of workspaces) {
      const n: N = { id: "ws:" + w.id, label: w.title, color: w.color, kind: "ws", kids: [], depth: 0, y: 0 };
      wsNodes.set(w.id, n);
      top.kids.push(n);
    }
    const placed = new Set<string>(home ? ["/"] : []);
    const queue: string[] = [];
    for (const w of workspaces) {
      for (const r of rows) {
        if (r.menu && r.ws === w.id && !placed.has(r.route)) {
          wsNodes.get(w.id)!.kids.push(nodes.get(r.route)!);
          placed.add(r.route);
          queue.push(r.route);
        }
      }
    }
    if (home) queue.push("/");
    const out = new Map<string, string[]>();
    for (const e of [...embeds, ...links]) {
      if (!byRoute.has(e.to) || !byRoute.has(e.from)) continue;
      out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    }
    for (let i = 0; i < queue.length; i++) {
      const u = queue[i];
      for (const v of out.get(u) ?? []) {
        if (placed.has(v)) continue;
        placed.add(v);
        nodes.get(u)!.kids.push(nodes.get(v)!);
        queue.push(v);
      }
    }
    const lost = rows.filter((r) => !placed.has(r.route));
    if (lost.length) {
      const g: N = { id: "lost", label: "No way in", color: "var(--viz-other)", kind: "group", kids: lost.map((r) => nodes.get(r.route)!), depth: 0, y: 0 };
      top.kids.push(g);
    }
    return top;
  }, [rows, workspaces, links, embeds, colorOf]);

  const { flat, height, width, pos } = useMemo(() => {
    const flat: N[] = [];
    let leaf = 0;
    const go = (n: N, d: number) => {
      n.depth = d;
      flat.push(n);
      const kids = shut.has(n.id) ? [] : n.kids;
      if (kids.length === 0) n.y = leaf++ * ROW;
      else {
        kids.forEach((k) => go(k, d + 1));
        n.y = (kids[0].y + kids[kids.length - 1].y) / 2;
      }
    };
    go(root, 0);
    const maxD = Math.max(...flat.map((n) => n.depth));
    const pos = new Map<string, N>();
    for (const n of flat) if (n.route) pos.set(n.route, n);
    return { flat, height: leaf * ROW + PAD * 2, width: (maxD + 1) * (W + GX) + PAD * 2, pos };
  }, [root, shut]);

  // a node hidden under a shut parent is not drawn
  const visible = useMemo(() => {
    const seen = new Set<string>();
    const go = (n: N) => {
      seen.add(n.id);
      if (!shut.has(n.id)) n.kids.forEach(go);
    };
    go(root);
    return seen;
  }, [root, shut]);

  const x = (n: N) => PAD + n.depth * (W + GX);
  const y = (n: N) => PAD + n.y;
  const rowOf = (n: N) => (n.route ? rows.find((r) => r.route === n.route) : undefined);

  const edges: { d: string; c: string; k: string }[] = [];
  const walk = (n: N) => {
    if (shut.has(n.id)) return;
    for (const k of n.kids) {
      if (!visible.has(k.id)) continue;
      const x1 = x(n) + W;
      const y1 = y(n) + H / 2;
      const x2 = x(k);
      const y2 = y(k) + H / 2;
      edges.push({ k: n.id + ">" + k.id, c: k.color, d: `M${x1} ${y1} C${x1 + GX / 2} ${y1},${x2 - GX / 2} ${y2},${x2} ${y2}` });
      walk(k);
    }
  };
  walk(root);

  // cross links of the selected page
  const cross: { d: string; c: string; k: string; dash: string }[] = [];
  const s = sel ? pos.get(sel) : undefined;
  if (s && visible.has(s.id)) {
    const treeKids = new Set(s.kids.map((k) => k.route));
    for (const e of [...links, ...embeds]) {
      if (e.from !== sel && e.to !== sel) continue;
      const other = pos.get(e.from === sel ? e.to : e.from);
      if (!other || !visible.has(other.id) || other === s) continue;
      if (e.from === sel && treeKids.has(e.to)) continue;
      const outgoing = e.from === sel;
      const a = outgoing ? s : other;
      const b = outgoing ? other : s;
      const x1 = x(a) + W;
      const y1 = y(a) + H / 2;
      const x2 = x(b);
      const y2 = y(b) + H / 2;
      let d: string;
      if (x2 >= x1) d = `M${x1} ${y1} C${x1 + GX} ${y1},${x2 - GX} ${y2},${x2} ${y2}`;
      else {
        // a backward link: leave the right of one node, enter the left of the other, looping round
        d = `M${x1} ${y1} C${x1 + 70} ${y1},${x2 - 70} ${y2},${x2} ${y2}`;
      }
      cross.push({ k: e.from + ">" + e.to, d, c: outgoing ? colorOf(e.to) : "var(--viz-other)", dash: outgoing ? "5 3" : "2 3" });
    }
  }

  const trunc = (t: string) => (t.length > 27 ? t.slice(0, 26) + "…" : t);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        <span>Left to right: Home → workspace → page → pages it opens.</span>
        <span>Tap a workspace to fold it. Tap a page to draw its other links: dashed colour = opens, dotted grey = comes from.</span>
      </div>
      <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: "75vh" }}>
        <svg width={width} height={height} role="img" aria-label="Page hierarchy" className="block">
          <g fill="none" strokeWidth={1.5}>
            {edges.map((e) => (
              <path key={e.k} d={e.d} stroke={e.c} opacity={0.55} />
            ))}
          </g>
          <g fill="none" strokeWidth={2}>
            {cross.map((e) => (
              <path key={e.k} d={e.d} stroke={e.c} strokeDasharray={e.dash} />
            ))}
          </g>
          {flat
            .filter((n) => visible.has(n.id))
            .map((n) => {
              const r = rowOf(n);
              const on = n.route && n.route === sel;
              const dim = r ? !match(r) : false;
              const hasKids = n.kids.length > 0;
              const click = () => {
                if (n.kind === "ws" || n.kind === "group" || (n.kind === "root" && hasKids && !n.route)) {
                  setShut((p) => {
                    const q = new Set(p);
                    q.has(n.id) ? q.delete(n.id) : q.add(n.id);
                    return q;
                  });
                } else if (n.route) setSel(on ? null : n.route);
              };
              const big = n.kind !== "page";
              return (
                <g
                  key={n.id}
                  transform={`translate(${x(n)} ${y(n)})`}
                  onClick={click}
                  style={{ cursor: "pointer", opacity: dim ? 0.3 : 1 }}
                >
                  <title>{n.route ? `${n.label} — ${n.route}` : n.label}</title>
                  <rect
                    width={W}
                    height={H}
                    rx={6}
                    fill={big ? n.color : "var(--chart-node, rgba(127,127,127,0.10))"}
                    fillOpacity={big ? 0.9 : 1}
                    stroke={n.color}
                    strokeWidth={on ? 3 : 1.5}
                  />
                  <rect width={5} height={H} rx={2} fill={n.color} />
                  <text
                    x={big ? 10 : 12}
                    y={H / 2 + 4}
                    fontSize={12}
                    fontWeight={big || on ? 700 : 500}
                    fill={big ? "#fff" : "currentColor"}
                    style={big ? { paintOrder: "stroke", stroke: "rgba(0,0,0,.35)", strokeWidth: 2 } : undefined}
                  >
                    {trunc(n.label)}
                    {shut.has(n.id) ? `  (+${count(n)})` : ""}
                  </text>
                  {r?.p7 && <circle cx={W - 10} cy={H / 2} r={4} fill="var(--warn, #b45309)" />}
                  {r && !r.menu && r.bars.length === 0 && r.inn.length + r.embedsIn.length === 0 && (
                    <circle cx={W - 10} cy={H / 2} r={4} fill="var(--danger, #b91c1c)" />
                  )}
                </g>
              );
            })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--warn, #b45309)" }} />
          in a Phase 7 fold
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--danger, #b91c1c)" }} />
          no way in
        </span>
        <span>Dimmed: does not match the filters above.</span>
      </div>
    </div>
  );
}

function count(n: N): number {
  return n.kids.reduce((a, k) => a + 1 + count(k), 0);
}
