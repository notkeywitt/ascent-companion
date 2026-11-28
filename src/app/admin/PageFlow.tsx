"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Input, Segmented, Select } from "@/components/ui";

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
  isNew?: boolean;
  kids: N[];
  parent?: N;
  rel: Rel;
  depth: number;
  y: number;
}
type Overrides = Record<string, { parent: string; rel?: Rel }>;
interface Added {
  id: string; // "new:<n>"
  label: string;
  parent: string;
  rel: Rel;
}
/** The whole sketch: moves, pages added, pages removed. */
interface Sketch {
  ov: Overrides;
  added: Added[];
  gone: string[];
}
const EMPTY: Sketch = { ov: {}, added: [], gone: [] };

const REL_NAME: Record<Rel, string> = {
  menu: "Menu row",
  tab: "Tab on the parent page",
  strip: "Tab strip, opens its own page",
  nav: "Navigation to another page",
  none: "",
};
const REL_SHORT: Record<Rel, string> = { menu: "", tab: "TAB", strip: "STRIP", nav: "NAV", none: "" };
const STORE = "pagemap.sketch.v2";
const STORE_V1 = "pagemap.overrides.v1";

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
  const [sk, setSk] = useState<Sketch>(EMPTY);
  const { ov, added, gone } = sk;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ label: string; parent: string; rel: Rel }>({ label: "", parent: "", rel: "nav" });
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- saved changes (this device)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const v = JSON.parse(raw);
        setSk({ ov: v.ov ?? {}, added: v.added ?? [], gone: v.gone ?? [] });
      } else {
        const v1 = JSON.parse(localStorage.getItem(STORE_V1) ?? "{}");
        if (v1 && typeof v1 === "object") setSk({ ...EMPTY, ov: v1 });
      }
    } catch {}
  }, []);
  const saveSk = (next: Sketch) => {
    setSk(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  };
  const saveOv = (next: Overrides) => saveSk({ ...sk, ov: next });

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
    (sketch: Sketch) => {
      const over = sketch.ov;
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
      // pages added in the sketch
      for (const a of sketch.added) {
        const p = nodes.get(a.parent);
        if (!p || p.kind === "group") continue;
        const n: N = { id: a.id, route: a.id, label: a.label, color: p.kind === "root" ? "var(--viz-other)" : p.color, kind: "page", isNew: true, kids: [], rel: "none", depth: 0, y: 0 };
        nodes.set(a.id, n);
        attach(p, n, a.rel);
      }
      // pages removed in the sketch: their own pages move up to the removed page's parent
      for (const id of sketch.gone) {
        const c = nodes.get(id);
        if (!c || c.kind !== "page" || c === top || !c.parent) continue;
        const up = c.parent;
        up.kids = up.kids.filter((k) => k !== c);
        for (const k of c.kids) attach(up, k, up.kind === "ws" ? "menu" : k.rel);
        nodes.delete(id);
      }
      return { top, nodes };
    },
    [rows, workspaces, links, embeds, colorOf, relOf],
  );

  const base = useMemo(() => build(EMPTY), [build]);
  const { top: root, nodes } = useMemo(() => build(sk), [build, sk]);
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
  const isNewId = (id: string) => id.startsWith("new:");
  const insideOf = (anc: N, n: N | undefined) => {
    for (let x: N | undefined = n; x; x = x.parent) if (x === anc) return true;
    return false;
  };
  const patchAdded = (id: string, patch: Partial<Added>) =>
    saveSk({ ...sk, added: added.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const moveTo = (id: string, parentId: string, rel?: Rel) => {
    const c = nodes.get(id);
    const p = nodes.get(parentId);
    if (!c || !p) return;
    if (p === c || insideOf(c, p)) {
      setNote("A page cannot sit under itself or its own pages");
      setTimeout(() => setNote(""), 2500);
      return;
    }
    if (isNewId(id)) {
      const relNow: Rel = rel ?? (p.kind === "ws" ? "menu" : c.rel === "menu" || c.rel === "none" ? "nav" : c.rel);
      patchAdded(id, { parent: parentId, rel: relNow });
      return;
    }
    const next = { ...ov };
    if (parentId === baseParent.get(id) && !rel) delete next[id];
    else next[id] = { parent: parentId, ...(rel ? { rel } : {}) };
    saveOv(next);
  };
  const setRelFor = (id: string, rel: Rel) => {
    const c = nodes.get(id);
    if (!c?.parent) return;
    if (isNewId(id)) patchAdded(id, { rel });
    else saveOv({ ...ov, [id]: { parent: c.parent.id, rel } });
  };
  const CYCLE: Rel[] = ["tab", "strip", "nav"];
  const cycleRel = (id: string) => {
    const c = nodes.get(id);
    if (!c || c.parent?.kind !== "page") return;
    const i = CYCLE.indexOf(c.rel);
    setRelFor(id, CYCLE[(i + 1) % CYCLE.length]);
  };
  const addPage = () => {
    const label = draft.label.trim();
    const parent = nodes.get(draft.parent);
    if (!label || !parent) return;
    const id = "new:" + Date.now();
    const rel: Rel = parent.kind === "ws" ? "menu" : draft.rel;
    saveSk({ ...sk, added: [...added, { id, label, parent: parent.id, rel }] });
    setDraft({ label: "", parent: draft.parent, rel: draft.rel });
    setAdding(false);
    setSel(id);
  };
  const removePage = (id: string) => {
    const c = nodes.get(id);
    if (!c?.parent) return;
    const up = c.parent.id;
    if (isNewId(id)) {
      // its own added pages move up with it
      saveSk({
        ...sk,
        added: added.filter((a) => a.id !== id).map((a) => (a.parent === id ? { ...a, parent: up } : a)),
        ov: Object.fromEntries(Object.entries(ov).map(([k, o]) => [k, o.parent === id ? { ...o, parent: up } : o])),
      });
    } else {
      const { [id]: _drop, ...rest } = ov;
      saveSk({
        ...sk,
        ov: rest,
        gone: [...gone, id],
        added: added.map((a) => (a.parent === id ? { ...a, parent: up } : a)),
      });
    }
    setSel(null);
  };
  const restorePage = (id: string) => saveSk({ ...sk, gone: gone.filter((g) => g !== id) });
  const nameOfId = (id: string) => nodes.get(id)?.label ?? base.nodes.get(id)?.label ?? id;
  const changes = [
    ...Object.entries(ov)
      .filter(([id, o]) => {
        const c = nodes.get(id);
        return c && c.parent?.id === o.parent;
      })
      .map(([id, o]) => {
        const c = nodes.get(id)!;
        const moved = o.parent !== baseParent.get(id);
        const from = nameOfId(baseParent.get(id) ?? "");
        return `${moved ? "MOVE" : "RE-LINK"} ${c.label} (${id}): ${moved ? `from ${from} to ${nameOfId(o.parent)}` : `under ${nameOfId(o.parent)}`}${c.rel !== "none" ? `, reached as ${REL_NAME[c.rel]}` : ""}`;
      }),
    ...added
      .filter((a) => nodes.get(a.id))
      .map((a) => `ADD "${a.label}" under ${nameOfId(a.parent)}${a.rel !== "none" ? `, reached as ${REL_NAME[a.rel]}` : ""}`),
    ...gone
      .filter((id) => base.nodes.get(id))
      .map((id) => `REMOVE ${nameOfId(id)} (${id}); its pages move up to ${nameOfId(baseParent.get(id) ?? "")}`),
  ];

  const outline = () => {
    const lines: string[] = [];
    const go = (n: N, d: number) => {
      const tag = n.rel === "none" || n.rel === "menu" ? (n.rel === "menu" ? " [menu]" : "") : ` [${REL_SHORT[n.rel]}]`;
      lines.push("  ".repeat(d) + n.label + (n.route && !n.isNew && n.route !== n.label ? ` ${n.route}` : "") + tag + (ov[n.id] ? " *moved*" : "") + (n.isNew ? " *new*" : ""));
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
  const edges: { d: string; c: string; k: string; rel: Rel; mx: number; my: number; cid: string; pk: N["kind"] }[] = [];
  const walk = (n: N) => {
    if (shut.has(n.id)) return;
    for (const k of n.kids) {
      const x1 = x(n) + W;
      const y1 = y(n) + H / 2;
      const x2 = x(k);
      const y2 = y(k) + H / 2;
      edges.push({
        k: n.id + ">" + k.id,
        cid: k.id,
        pk: n.kind,
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
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--danger, #b91c1c)" }} />
          no way in
        </span>
        <span>Dashed box = moved or added in your sketch</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-control bg-neutral-100 p-2 text-xs dark:bg-white/[0.07]">
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
                onChange={(v) => setRelFor(selNode.id, v)}
                options={[
                  { value: "tab", label: "Tab" },
                  { value: "strip", label: "Strip" },
                  { value: "nav", label: "Nav" },
                ]}
              />
            )}
            {!isNewId(selNode.id) && ov[selNode.id] && (
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
            <Button size="xs" variant="danger" onClick={() => removePage(selNode.id)}>
              Remove page
            </Button>
          </>
        ) : (
          <span className="text-neutral-500">Tap a page to move it or change how it is reached. Tap a workspace to fold it.</span>
        )}
        <Button size="xs" variant={adding ? "primary" : "secondary"} onClick={() => setAdding(!adding)}>
          {adding ? "Cancel add" : "Add page"}
        </Button>
        {gone.some((id) => base.nodes.get(id)) && (
          <Select aria-label="Restore a removed page" value="" onChange={(e) => e.target.value && restorePage(e.target.value)} className="!w-auto max-w-[12rem]">
            <option value="">Restore removed…</option>
            {gone
              .filter((id) => base.nodes.get(id))
              .map((id) => (
                <option key={id} value={id}>
                  {nameOfId(id)}
                </option>
              ))}
          </Select>
        )}
        {changes.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <b>{changes.length} change{changes.length > 1 ? "s" : ""}</b>
            <Button size="xs" variant="secondary" onClick={() => copy(changes.join("\n"), "Changes")}>
              Copy changes
            </Button>
            <Button size="xs" variant="secondary" onClick={() => saveSk(EMPTY)}>
              Reset all
            </Button>
          </span>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-line p-2 text-xs">
          <Input
            aria-label="New page name"
            placeholder="New page name"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addPage()}
            className="!w-48"
          />
          <Select aria-label="Put it under" value={draft.parent} onChange={(e) => setDraft({ ...draft, parent: e.target.value })} className="!w-auto max-w-[14rem]">
            <option value="">Put it under…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.kind === "ws" ? "Workspace: " : ""}
                {t.label}
              </option>
            ))}
          </Select>
          {nodes.get(draft.parent)?.kind === "page" || nodes.get(draft.parent)?.kind === "root" ? (
            <Segmented
              label="How it is reached"
              value={draft.rel === "menu" || draft.rel === "none" ? "nav" : (draft.rel as "tab" | "strip" | "nav")}
              onChange={(v) => setDraft({ ...draft, rel: v })}
              options={[
                { value: "tab", label: "Tab" },
                { value: "strip", label: "Strip" },
                { value: "nav", label: "Nav" },
              ]}
            />
          ) : null}
          <Button size="xs" onClick={addPage} disabled={!draft.label.trim() || !draft.parent}>
            Add
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 overflow-auto rounded-control border border-line"
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
                <g
                  key={"b" + e.k}
                  transform={`translate(${e.mx - w / 2} ${e.my - 7})`}
                  onClick={() => cycleRel(e.cid)}
                  style={{ cursor: e.pk === "page" ? "pointer" : "default" }}
                >
                  <title>{e.pk === "page" ? "Click to change: Tab, Strip, Nav" : REL_NAME[e.rel]}</title>
                  <rect width={w} height={14} rx={3} fill="var(--chart-badge, #fff)" stroke={e.c} strokeWidth={1} />
                  <text x={w / 2} y={10.5} fontSize={9} style={{ userSelect: "none" }} fontWeight={700} textAnchor="middle" fill="#444">
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
            const moved = n.isNew || (!!n.parent && ov[n.id]?.parent === n.parent.id);
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
                {n.isNew && (
                  <text x={W - 28} y={H / 2 + 4} fontSize={9} fontWeight={700} fill="var(--ok, #047857)">
                    NEW
                  </text>
                )}
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
