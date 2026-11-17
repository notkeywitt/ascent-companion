"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Segmented, Select } from "@/components/ui";

import type { Row } from "./PageMapPanel";

/**
 * The Page Map as a left-to-right tree: Home, then each workspace, then its
 * pages, then the pages each one opens that no menu reaches (a hub's sections,
 * a job's tabs). A page sits under the nearest parent: a workspace for a menu
 * row, else the page that draws it or links to it. Pages nothing reaches hang
 * under "No way in".
 *
 * Every parent → child line carries how the person gets there:
 *   MENU   a row in the ☰ menu (workspace → page)
 *   TAB    a tab ON the parent page: the page draws it inside itself (Jobs Hub's
 *          Checks), or opens it with ?section= / ?tab=
 *   STRIP  a tab row that looks like a tab but opens its own route (Job tabs,
 *          Audit's System Logs · Journal)
 *   NAV    a link or button that goes to another page
 *
 * The chart zooms, goes full screen, and can be rearranged: pick a page, move
 * it under another parent, change how it is reached. Changes are a sketch for
 * planning (kept on this device); the app itself is not touched.
 */

export type Rel = "menu" | "tab" | "strip" | "nav" | "none";
interface LinkIn {
  from: string;
  to: string;
  kind: "link" | "push" | "redirect" | "strip";
  q?: string[];
}
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
  parent?: N;
  rel: Rel;
  depth: number;
  y: number;
}
type Overrides = Record<string, { parent: string; rel?: Rel }>;

const REL_NAME: Record<Rel, string> = {
  menu: "Menu row",
  tab: "Tab on the parent page",
  strip: "Tab strip, opens its own page",
  nav: "Navigation to another page",
  none: "",
};
const REL_SHORT: Record<Rel, string> = { menu: "", tab: "TAB", strip: "STRIP", nav: "NAV", none: "" };
const STORE = "pagemap.overrides.v1";

const W = 196;
const H = 24;
const GX = 78;
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
  links: LinkIn[];
  embeds: Edge[];
  colorOf: (route: string) => string;
  match: (r: Row) => boolean;
  sel: string | null;
  setSel: (route: string | null) => void;
}) {
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(1);
  const [full, setFull] = useState(false);
  const [fake, setFake] = useState(false); // viewport-filling frame where the browser has no element fullscreen
  const [ov, setOv] = useState<Overrides>({});
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- saved changes (this device)
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
      if (v && typeof v === "object") setOv(v);
    } catch {}
  }, []);
  const saveOv = (next: Overrides) => {
    setOv(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  };

  const relOf = useCallback(
    (from: string, to: string): Rel => {
      const ls = links.filter((l) => l.from === from && l.to === to);
      if (ls.some((l) => l.kind === "strip")) return "strip";
      if (embeds.some((e) => e.from === from && e.to === to)) return "tab";
      if (ls.some((l) => l.q && l.q.length)) return "tab";
      return "nav";
    },
    [links, embeds],
  );

  // ---- the tree
  const build = useCallback(
    (over: Overrides) => {
      const byRoute = new Map(rows.map((r) => [r.route, r]));
      const nodes = new Map<string, N>();
      for (const r of rows) {
        nodes.set(r.route, { id: r.route, route: r.route, label: r.label, color: colorOf(r.route), kind: "page", kids: [], rel: "none", depth: 0, y: 0 });
      }
      const home = nodes.get("/");
      const top: N = home ?? { id: "root", label: "Home", color: "var(--viz-other)", kind: "root", kids: [], rel: "none", depth: 0, y: 0 };
      nodes.set(top.id, top);
      const attach = (p: N, c: N, rel: Rel) => {
        c.parent = p;
        c.rel = rel;
        p.kids.push(c);
      };
      const wsNodes = new Map<string, N>();
      for (const w of workspaces) {
        const n: N = { id: "ws:" + w.id, label: w.title, color: w.color, kind: "ws", kids: [], rel: "none", depth: 0, y: 0 };
        wsNodes.set(w.id, n);
        nodes.set(n.id, n);
        attach(top, n, "none");
      }
      const placed = new Set<string>(home ? ["/"] : []);
      const queue: string[] = [];
      for (const w of workspaces) {
        for (const r of rows) {
          if (r.menu && r.ws === w.id && !placed.has(r.route)) {
            attach(wsNodes.get(w.id)!, nodes.get(r.route)!, "menu");
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
          attach(nodes.get(u)!, nodes.get(v)!, relOf(u, v));
          queue.push(v);
        }
      }
      const lost = rows.filter((r) => !placed.has(r.route));
      if (lost.length) {
        const g: N = { id: "lost", label: "No way in", color: "var(--viz-other)", kids: [], kind: "group", rel: "none", depth: 0, y: 0 };
        nodes.set("lost", g);
        attach(top, g, "none");
        for (const r of lost) attach(g, nodes.get(r.route)!, "none");
      }
      // ---- the sketch's changes
      const inside = (anc: N, n: N | undefined): boolean => {
        for (let x = n; x; x = x.parent) if (x === anc) return true;
        return false;
      };
      for (const [id, o] of Object.entries(over)) {
        const c = nodes.get(id);
        const p = nodes.get(o.parent);
        if (!c || !p || c === top || c.kind !== "page" || p === c || inside(c, p)) continue;
        c.parent!.kids = c.parent!.kids.filter((k) => k !== c);
        const rel: Rel = o.rel ?? (p.kind === "ws" ? "menu" : p.kind === "page" ? relOf(p.route!, c.route!) : "none");
        attach(p, c, rel);
      }
      return { top, nodes };
    },
    [rows, workspaces, links, embeds, colorOf, relOf],
  );

  const base = useMemo(() => build({}), [build]);
  const { top: root, nodes } = useMemo(() => build(ov), [build, ov]);
  const baseParent = useMemo(() => {
    const m = new Map<string, string>();
    base.nodes.forEach((n, id) => n.parent && m.set(id, n.parent.id));
    return m;
  }, [base]);

  // ---- layout
  const { flat, height, width, pos, visible } = useMemo(() => {
    const flat: N[] = [];
    const visible = new Set<string>();
    let leaf = 0;
    const go = (n: N, d: number) => {
      n.depth = d;
      flat.push(n);
      visible.add(n.id);
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
    return { flat, visible, pos, height: leaf * ROW + PAD * 2, width: (maxD + 1) * (W + GX) + PAD * 2 - GX };
  }, [root, shut]);

  const x = (n: N) => PAD + n.depth * (W + GX);
  const y = (n: N) => PAD + n.y;
  const rowOf = (n: N) => (n.route ? rows.find((r) => r.route === n.route) : undefined);

  // ---- zoom
  const zoomTo = useCallback((next: number) => {
    const el = scrollRef.current;
    setScale((old) => {
      const z = Math.min(2.5, Math.max(0.25, next));
      if (el) {
        const cx = (el.scrollLeft + el.clientWidth / 2) / old;
        const cy = (el.scrollTop + el.clientHeight / 2) / old;
        requestAnimationFrame(() => {
          el.scrollLeft = cx * z - el.clientWidth / 2;
          el.scrollTop = cy * z - el.clientHeight / 2;
        });
      }
      return z;
    });
  }, []);
  const fit = () => {
    const el = scrollRef.current;
    if (el) zoomTo(Math.min(1.5, (el.clientWidth - 4) / width));
  };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // a plain wheel scrolls; Ctrl/⌘ + wheel or a trackpad pinch zooms
      e.preventDefault();
      zoomTo(scaleRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // ---- full screen
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFull = async () => {
    if (full || fake) {
      setFake(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    try {
      if (boxRef.current?.requestFullscreen) await boxRef.current.requestFullscreen();
      else setFake(true);
    } catch {
      setFake(true);
    }
  };
  const framed = full || fake;
  useEffect(() => {
    if (!fake) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setFake(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [fake]);
  useEffect(() => {
    if (!picking) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPicking(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [picking]);

  // ---- changes
  const selNode = sel ? nodes.get(sel) : undefined;
  const moveTo = (routeOrId: string, parentId: string, rel?: Rel) => {
    const next = { ...ov };
    const o = parentId === baseParent.get(routeOrId) && !rel ? undefined : { parent: parentId, ...(rel ? { rel } : {}) };
    if (o) next[routeOrId] = o;
    else delete next[routeOrId];
    saveOv(next);
  };
  const setRel = (rel: Rel) => {
    if (!selNode?.parent) return;
    saveOv({ ...ov, [selNode.id]: { parent: selNode.parent.id, rel } });
  };
  const nameOfId = (id: string) => nodes.get(id)?.label ?? id;
  const changes = Object.entries(ov)
    .filter(([id, o]) => {
      const c = nodes.get(id);
      return c && c.parent?.id === o.parent;
    })
    .map(([id, o]) => {
      const c = nodes.get(id)!;
      const moved = o.parent !== baseParent.get(id);
      const from = nameOfId(baseParent.get(id) ?? "");
      return `${c.label} (${id}): ${moved ? `move from ${from} to ${nameOfId(o.parent)}` : `stay under ${nameOfId(o.parent)}`}${c.rel !== "none" ? `, reached as ${REL_NAME[c.rel]}` : ""}`;
    });

  const outline = () => {
    const lines: string[] = [];
    const go = (n: N, d: number) => {
      const tag = n.rel === "none" || n.rel === "menu" ? (n.rel === "menu" ? " [menu]" : "") : ` [${REL_SHORT[n.rel]}]`;
      lines.push("  ".repeat(d) + n.label + (n.route && n.route !== n.label ? ` ${n.route}` : "") + tag + (ov[n.id] ? " *moved*" : ""));
      n.kids.forEach((k) => go(k, d + 1));
    };
    go(root, 0);
    return lines.join("\n");
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${what} copied`);
    } catch {
      setNote("Copy is blocked in this browser");
    }
    setTimeout(() => setNote(""), 2500);
  };

  // ---- drawing
  const edges: { d: string; c: string; k: string; rel: Rel; mx: number; my: number }[] = [];
  const walk = (n: N) => {
    if (shut.has(n.id)) return;
    for (const k of n.kids) {
      const x1 = x(n) + W;
      const y1 = y(n) + H / 2;
      const x2 = x(k);
      const y2 = y(k) + H / 2;
      edges.push({
        k: n.id + ">" + k.id,
        c: k.color,
        rel: k.rel,
        mx: x2 - 24,
        my: y2,
        d: `M${x1} ${y1} C${x1 + GX / 2} ${y1},${x2 - GX / 2} ${y2},${x2} ${y2}`,
      });
      walk(k);
    }
  };
  walk(root);

  const cross: { d: string; c: string; k: string; dash: string }[] = [];
  const s = sel ? pos.get(sel) : undefined;
  if (s && visible.has(s.id)) {
    const treeKids = new Set(s.kids.map((k) => k.route));
    for (const e of [...links, ...embeds]) {
      if (e.from !== sel && e.to !== sel) continue;
      const other = pos.get(e.from === sel ? e.to : e.from);
      if (!other || other === s) continue;
      if (e.from === sel && treeKids.has(e.to)) continue;
      const outgoing = e.from === sel;
      const a = outgoing ? s : other;
      const b = outgoing ? other : s;
      const x1 = x(a) + W;
      const y1 = y(a) + H / 2;
      const x2 = x(b);
      const y2 = y(b) + H / 2;
      const d = x2 >= x1 ? `M${x1} ${y1} C${x1 + GX} ${y1},${x2 - GX} ${y2},${x2} ${y2}` : `M${x1} ${y1} C${x1 + 70} ${y1},${x2 - 70} ${y2},${x2} ${y2}`;
      cross.push({ k: e.from + ">" + e.to, d, c: outgoing ? colorOf(e.to) : "var(--viz-other)", dash: outgoing ? "5 3" : "2 3" });
    }
  }

  const trunc = (t: string) => (t.length > 27 ? t.slice(0, 26) + "…" : t);
  const count = (n: N): number => n.kids.reduce((a, k) => a + 1 + count(k), 0);
  const targets = useMemo(
    () => [...nodes.values()].filter((n) => n.kind === "ws" || n.kind === "page" || n.kind === "root").sort((a, b) => a.label.localeCompare(b.label)),
    [nodes],
  );
  const stroke = (rel: Rel) =>
    rel === "tab"
      ? { w: 3, dash: undefined, o: 0.85 }
      : rel === "strip"
        ? { w: 2, dash: "7 2 2 2", o: 0.8 }
        : rel === "nav"
          ? { w: 1.6, dash: "4 4", o: 0.8 }
          : { w: 1.5, dash: undefined, o: 0.5 };

  const onNode = (n: N) => {
    if (picking && selNode && n.kind !== "group") {
      moveTo(selNode.id, n.id);
      setPicking(false);
      return;
    }
    if (n.kind === "ws" || n.kind === "group") {
      setShut((p) => {
        const q = new Set(p);
        q.has(n.id) ? q.delete(n.id) : q.add(n.id);
        return q;
      });
    } else if (n.route) setSel(sel === n.route ? null : n.route);
  };

  return (
    <div
      ref={boxRef}
      className={
        fake
          ? "fixed inset-0 z-[60] flex flex-col gap-2 bg-white p-3 text-neutral-900 dark:bg-ink dark:text-neutral-100"
          : full
            ? "flex h-full flex-col gap-2 bg-white p-3 text-neutral-900 dark:bg-ink dark:text-neutral-100"
            : ""
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="secondary" onClick={() => zoomTo(scale / 1.25)} aria-label="Zoom out">
          −
        </Button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
        <Button size="xs" variant="secondary" onClick={() => zoomTo(scale * 1.25)} aria-label="Zoom in">
          +
        </Button>
        <Button size="xs" variant="secondary" onClick={fit}>
          Fit width
        </Button>
        <Button size="xs" variant="secondary" onClick={() => zoomTo(1)}>
          100%
        </Button>
        <Button size="xs" variant="secondary" onClick={toggleFull}>
          {framed ? "Exit full screen" : "Full screen"}
        </Button>
        <Button size="xs" variant="secondary" onClick={() => copy(outline(), "Outline")}>
          Copy outline
        </Button>
        <span className="text-xs text-neutral-500">{note}</span>
        <span className="ml-auto hidden text-xs text-neutral-500 pad:inline">Ctrl or ⌘ + scroll zooms</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        <Legend rel="menu" text="MENU row" />
        <Legend rel="tab" text="TAB on the parent page" />
        <Legend rel="strip" text="STRIP tab, own page" />
        <Legend rel="nav" text="NAV to another page" />
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--warn, #b45309)" }} />
          Phase 7 fold
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--danger, #b91c1c)" }} />
          no way in
        </span>
        <span>Dashed box = moved in your sketch</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-100 p-2 text-xs dark:bg-white/[0.07]">
        {selNode && selNode.kind === "page" && selNode !== root ? (
          <>
            <b className="text-sm">{selNode.label}</b>
            <span className="text-neutral-500">under {selNode.parent?.label}</span>
            <Select
              aria-label="Move under"
              value=""
              onChange={(e) => e.target.value && moveTo(selNode.id, e.target.value)}
              className="!w-auto max-w-[13rem]"
            >
              <option value="">Move under…</option>
              {targets
                .filter((t) => t !== selNode)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.kind === "ws" ? "Workspace: " : ""}
                    {t.label}
                  </option>
                ))}
            </Select>
            <Button size="xs" variant={picking ? "primary" : "secondary"} onClick={() => setPicking(!picking)}>
              {picking ? "Tap the new parent… (Esc)" : "Pick on chart"}
            </Button>
            {selNode.parent?.kind === "page" && (
              <Segmented
                label="How it is reached"
                value={(selNode.rel === "none" || selNode.rel === "menu" ? "nav" : selNode.rel) as "tab" | "strip" | "nav"}
                onChange={(v) => setRel(v)}
                options={[
                  { value: "tab", label: "Tab" },
                  { value: "strip", label: "Strip" },
                  { value: "nav", label: "Nav" },
                ]}
              />
            )}
            {ov[selNode.id] && (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  const { [selNode.id]: _x, ...rest } = ov;
                  saveOv(rest);
                }}
              >
                Undo this page
              </Button>
            )}
          </>
        ) : (
          <span className="text-neutral-500">Tap a page to move it or change how it is reached. Tap a workspace to fold it.</span>
        )}
        {changes.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <b>{changes.length} change{changes.length > 1 ? "s" : ""}</b>
            <Button size="xs" variant="secondary" onClick={() => copy(changes.join("\n"), "Changes")}>
              Copy changes
            </Button>
            <Button size="xs" variant="secondary" onClick={() => saveOv({})}>
              Reset all
            </Button>
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 overflow-auto rounded-lg border border-line"
        style={framed ? { flex: "1 1 0" } : { maxHeight: "75vh" }}
      >
        <svg width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Page hierarchy" className="block">
          <g fill="none">
            {edges.map((e) => {
              const st = stroke(e.rel);
              return <path key={e.k} d={e.d} stroke={e.c} strokeWidth={st.w} strokeDasharray={st.dash} opacity={st.o} />;
            })}
          </g>
          <g fill="none" strokeWidth={2}>
            {cross.map((e) => (
              <path key={e.k} d={e.d} stroke={e.c} strokeDasharray={e.dash} />
            ))}
          </g>
          {edges
            .filter((e) => REL_SHORT[e.rel])
            .map((e) => {
              const t = REL_SHORT[e.rel];
              const w = t.length * 6 + 8;
              return (
                <g key={"b" + e.k} transform={`translate(${e.mx - w / 2} ${e.my - 7})`} pointerEvents="none">
                  <rect width={w} height={14} rx={3} fill="var(--chart-badge, #fff)" stroke={e.c} strokeWidth={1} />
                  <text x={w / 2} y={10.5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#444">
                    {t}
                  </text>
                </g>
              );
            })}
          {flat.map((n) => {
            const r = rowOf(n);
            const on = !!n.route && n.route === sel;
            const dim = r ? !match(r) : false;
            const big = n.kind !== "page";
            const moved = !!n.parent && ov[n.id]?.parent === n.parent.id;
            return (
              <g
                key={n.id}
                transform={`translate(${x(n)} ${y(n)})`}
                onClick={() => onNode(n)}
                style={{ cursor: picking ? "crosshair" : "pointer", opacity: dim ? 0.3 : 1 }}
              >
                <title>{n.route ? `${n.label} — ${n.route}${n.rel !== "none" ? " — " + REL_NAME[n.rel] : ""}` : n.label}</title>
                <rect
                  width={W}
                  height={H}
                  rx={6}
                  fill={big ? n.color : "var(--chart-node, rgba(127,127,127,0.10))"}
                  fillOpacity={big ? 0.9 : 1}
                  stroke={n.color}
                  strokeWidth={on ? 3.5 : 1.5}
                  strokeDasharray={moved ? "5 3" : undefined}
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
    </div>
  );
}

function Legend({ rel, text }: { rel: Rel; text: string }) {
  const dash = rel === "strip" ? "7 2 2 2" : rel === "nav" ? "4 4" : undefined;
  const w = rel === "tab" ? 3 : rel === "nav" ? 1.6 : rel === "strip" ? 2 : 1.5;
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="30" height="8" aria-hidden>
        <line x1="0" y1="4" x2="30" y2="4" stroke="currentColor" strokeWidth={w} strokeDasharray={dash} opacity={rel === "menu" ? 0.5 : 0.85} />
      </svg>
      {text}
    </span>
  );
}
