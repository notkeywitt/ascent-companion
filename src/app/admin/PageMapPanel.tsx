"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Card, FilterChip, Input, SectionLabel, Segmented } from "@/components/ui";
import { PageFlow } from "./PageFlow";
import raw from "@/lib/pageMap.generated.json";
import { ROLE_VIEWS, ROLES, VIEWS, viewIdForPath, type Role } from "@/lib/views";
import {
  BARS,
  BILLS_TABS,
  EXTRA_LINKS,
  JOB_PAGES,
  OUTSIDE_WORKSPACES,
  WORKSPACES,
  type WorkspaceTab,
} from "@/lib/workspaces";

/**
 * Admin → Page Map. Every page, coloured by its workspace, with how a person
 * gets into it and where it leads.
 *
 * Live (always current): workspace, view gate, roles, bar slots, menu rows —
 * read from workspaces.ts and views.ts. Scanned (current at each build, see
 * scripts/gen-page-map.mjs): the links between pages, the pages one page draws
 * inside itself, and the redirects.
 */

interface Link {
  from: string;
  to: string;
  kind: "link" | "push" | "redirect" | "strip";
  q?: string[];
}
const MAP = raw as {
  pages: { route: string; file: string }[];
  redirects: { from: string; to: string }[];
  links: Link[];
  embeds: { from: string; to: string }[];
};

/** The page folds proposed on the roadmap (`page-folds` in src/lib/roadmap.ts). */
const PHASE7: { id: string; label: string; routes: string[] }[] = [
  { id: "bills", label: "Bills hub", routes: ["/bills", "/email", "/payments", "/lswdd", "/amazon-import", "/add-bill"] },
  { id: "find", label: "Find", routes: ["/vendors", "/bill-search", "/expenditure-history", "/vendor-mail/index"] },
  { id: "people", label: "People", routes: ["/employees", "/labor-rates", "/onboarding/office", "/payroll", "/time-off"] },
  { id: "admin", label: "Admin", routes: ["/admin", "/ascentbot", "/admin/copy", "/theme", "/logs", "/journal", "/ai-cost"] },
];

const ROLE_LETTER: Record<Role, string> = { admin: "A", office: "O", lead: "L", field: "F" };
const ROLE_NAME: Record<Role, string> = { admin: "Admin", office: "Office", lead: "Lead", field: "Field" };
const OUTSIDE = "outside";

/** Eight chart colours, then they repeat; the name is always written beside the colour. */
const hue = (i: number) => (i < 0 ? "var(--viz-other)" : `var(--viz-${(i % 8) + 1})`);

export interface Row {
  route: string;
  label: string;
  ws: string; // workspace id or OUTSIDE
  wsTitle: string;
  view: string | null;
  roles: Role[];
  menu: boolean;
  bars: Role[];
  searchOnly: string; // why it is on no menu
  out: Link[];
  inn: Link[];
  embedsOut: string[];
  embedsIn: string[];
  redirectsIn: string[];
  p7: string;
  views30: number | null;
}

function build(): { rows: Row[]; wsIndex: Map<string, number> } {
  const wsIndex = new Map<string, number>(WORKSPACES.map((w, i) => [w.id, i]));
  const tabByHref = new Map<string, { tab: WorkspaceTab; ws: string; wsTitle: string }>();
  for (const w of WORKSPACES) for (const t of w.tabs) tabByHref.set(t.href, { tab: t, ws: w.id, wsTitle: w.title });
  const otherTab = new Map<string, WorkspaceTab>();
  for (const t of [...JOB_PAGES, ...BILLS_TABS, ...EXTRA_LINKS]) otherTab.set(t.href, t);
  const viewTab = new Map<string, { tab: WorkspaceTab; ws: string; wsTitle: string }>();
  for (const w of WORKSPACES) for (const t of w.tabs) if (!viewTab.has(t.view)) viewTab.set(t.view, { tab: t, ws: w.id, wsTitle: w.title });

  const rows: Row[] = MAP.pages.map((p) => {
    const view = viewIdForPath(p.route.replace(/\[[^\]]+\]/g, "x"));
    const own = tabByHref.get(p.route);
    const viaView = view ? viewTab.get(view) : undefined;
    const placed = own ?? viaView;
    const label =
      own?.tab.label ??
      otherTab.get(p.route)?.label ??
      VIEWS.find((v) => v.id === view)?.label ??
      (p.route === "/" ? "Home" : p.route);
    const roles = view ? ROLES.filter((r) => ROLE_VIEWS[r].includes(view)) : ROLES;
    const bars = ROLES.filter((r) =>
      BARS[r].some((s) => (s.kind === "today" ? p.route === "/" : s.kind === "tab" && s.view === view)),
    );
    const p7 = PHASE7.find((g) => g.routes.includes(p.route))?.label ?? "";
    return {
      route: p.route,
      label,
      ws: placed ? placed.ws : OUTSIDE,
      wsTitle: placed ? placed.wsTitle : p.route === "/" ? "Home" : "Not in a menu",
      view,
      roles,
      menu: !!own,
      bars,
      searchOnly: view ? OUTSIDE_WORKSPACES[view] ?? "" : "",
      out: MAP.links.filter((l) => l.from === p.route),
      inn: MAP.links.filter((l) => l.to === p.route),
      embedsOut: MAP.embeds.filter((e) => e.from === p.route).map((e) => e.to),
      embedsIn: MAP.embeds.filter((e) => e.to === p.route).map((e) => e.from),
      redirectsIn: MAP.redirects.filter((r) => r.to.split("?")[0] === p.route).map((r) => r.from),
      p7,
      views30: null,
    };
  });
  // Pages that share a gate share its label. A page with no menu row of its
  // own that repeats a label shows its route instead, so every node reads apart.
  const used = new Map<string, number>();
  for (const r of rows) used.set(r.label, (used.get(r.label) ?? 0) + 1);
  for (const r of rows) {
    if ((used.get(r.label) ?? 0) > 1 && !tabByHref.has(r.route)) r.label = r.route;
  }
  return { rows, wsIndex };
}

const noWay = (r: Row) => !r.menu && r.bars.length === 0 && r.inn.length === 0 && r.embedsIn.length === 0;

export function PageMapPanel() {
  const { rows: base, wsIndex } = useMemo(build, []);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [q, setQ] = useState("");
  const [wsOn, setWsOn] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [lens, setLens] = useState<"" | "p7" | "noway">("");
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<"flow" | "cards">("flow");

  useEffect(() => {
    let live = true;
    fetch("/api/usage?days=30")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { routes?: { key: string; views: number }[] } | null) => {
        if (!live || !d?.routes) return;
        const m: Record<string, number> = {};
        for (const r of d.routes) m[r.key] = r.views;
        setCounts(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(
    () => base.map((r) => ({ ...r, views30: counts && r.view ? counts[r.view] ?? 0 : null })),
    [base, counts],
  );
  const byRoute = useMemo(() => new Map(rows.map((r) => [r.route, r])), [rows]);
  const colorOf = (route: string) => {
    const r = byRoute.get(route);
    return hue(r && r.ws !== OUTSIDE ? wsIndex.get(r.ws) ?? -1 : -1);
  };
  const nameOf = (route: string) => byRoute.get(route)?.label ?? route;

  const keepNoWs = (r: Row) => {
    const needle = q.trim().toLowerCase();
    return (
      (!role || r.roles.includes(role)) &&
      (lens === "" || (lens === "p7" ? !!r.p7 : noWay(r))) &&
      (!needle || (r.label + " " + r.route).toLowerCase().includes(needle))
    );
  };
  const wsList = useMemo(
    () => WORKSPACES.map((w, i) => ({ id: w.id, title: w.title, color: hue(i) })),
    [],
  );
  const groups = useMemo(() => {
    const keep = (r: Row) => (!wsOn || r.ws === wsOn) && keepNoWs(r);
    const order = [...WORKSPACES.map((w) => ({ id: w.id, title: w.title })), { id: OUTSIDE, title: "Reached only from other pages, or on no menu" }];
    return order
      .map((g) => ({ ...g, rows: rows.filter((r) => (r.ws === g.id || (g.id === OUTSIDE && r.ws === OUTSIDE)) && keep(r)) }))
      .filter((g) => g.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, wsOn, role, lens]);

  const picked = sel ? byRoute.get(sel) : undefined;
  const flagged = rows.filter(noWay).length;

  const jump = (route: string) => {
    setSel(route);
    if (mode === "cards") requestAnimationFrame(() => document.getElementById("pm-" + route)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  return (
    <div>
      <Banner tone="info">
        {rows.length} pages. Colour is the workspace the page sits in. Tap a page to see where it opens and how to reach it.
        Workspace, gate, roles and menu are live. Links between pages come from a scan taken at the last build.
      </Banner>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterChip on={wsOn === null && !lens} onClick={() => { setWsOn(null); setLens(""); }}>
          All
        </FilterChip>
        {[...WORKSPACES.map((w) => ({ id: w.id, title: w.title })), { id: OUTSIDE, title: "On no menu" }].map((w) => (
          <FilterChip key={w.id} on={wsOn === w.id} onClick={() => setWsOn(wsOn === w.id ? null : w.id)}>
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: hue(w.id === OUTSIDE ? -1 : wsIndex.get(w.id) ?? -1) }} />
            {w.title}
          </FilterChip>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {ROLES.map((r) => (
          <FilterChip key={r} on={role === r} onClick={() => setRole(role === r ? null : r)} title={`Pages a ${ROLE_NAME[r]} can open`}>
            {ROLE_NAME[r]} sees
          </FilterChip>
        ))}
        <FilterChip on={lens === "p7"} onClick={() => setLens(lens === "p7" ? "" : "p7")} title="Pages the roadmap proposes to fold into hubs">
          Proposed folds
        </FilterChip>
        <FilterChip on={lens === "noway"} onClick={() => setLens(lens === "noway" ? "" : "noway")} title="No menu row, no bar slot, no link from another page">
          No way in ({flagged})
        </FilterChip>
        <Input placeholder="Find a page" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-[14rem]" />
      </div>

      {lens === "p7" && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          {PHASE7.map((g) => (
            <span key={g.id}>
              <b>{g.label}:</b> {g.routes.length} pages
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        <Segmented
          label="View"
          value={mode}
          onChange={setMode}
          options={[
            { value: "flow", label: "Flow chart" },
            { value: "cards", label: "Cards" },
          ]}
        />
      </div>

      {mode === "flow" && (
        <div className="mt-4">
          <PageFlow
            rows={rows}
            workspaces={wsList}
            links={MAP.links}
            embeds={MAP.embeds}
            colorOf={colorOf}
            match={keepNoWs}
            sel={sel}
            setSel={setSel}
          />
          {picked && (
            <Card pad={false} className="mt-3">
              <div className="px-3 pt-2 text-sm font-semibold">
                {picked.label} <span className="font-mono text-[11px] font-normal text-neutral-500">{picked.route}</span>
              </div>
              <Detail r={picked} colorOf={colorOf} nameOf={nameOf} jump={jump} />
            </Card>
          )}
        </div>
      )}

      <div className={mode === "cards" ? "mt-5 space-y-6" : "hidden"}>
        {groups.map((g) => {
          const c = hue(g.id === OUTSIDE ? -1 : wsIndex.get(g.id) ?? -1);
          return (
            <section key={g.id}>
              <div className="mb-2 flex items-center gap-2 border-l-4 pl-2" style={{ borderColor: c }}>
                <SectionLabel className="mb-0">{g.title}</SectionLabel>
                <span className="text-xs text-neutral-500">{g.rows.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 pad:grid-cols-2 lg:grid-cols-3">
                {g.rows.map((r) => {
                  const open = sel === r.route;
                  return (
                    <div key={r.route} id={"pm-" + r.route} className={open ? "col-span-full" : ""}>
                      <Card pad={false} className="overflow-hidden" >
                        <button
                          type="button"
                          onClick={() => setSel(open ? null : r.route)}
                          aria-expanded={open}
                          className="block w-full border-l-4 px-3 py-2 text-left"
                          style={{ borderColor: c }}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold">{r.label}</span>
                            <span className="shrink-0 text-[11px] text-neutral-500">
                              {r.views30 !== null ? `${r.views30} views / 30d` : ""}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-neutral-500">{r.route}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                            <span title="Roles that can open it">
                              {ROLES.map((x) => (
                                <span
                                  key={x}
                                  className={`mr-0.5 inline-block w-4 rounded-chip text-center font-semibold ${
                                    r.roles.includes(x) ? "bg-ok/15 text-ok" : "text-neutral-400 line-through"
                                  }`}
                                >
                                  {ROLE_LETTER[x]}
                                </span>
                              ))}
                            </span>
                            <span>{r.menu ? "☰ menu" : r.searchOnly ? "search / in-page" : "no menu"}</span>
                            {r.bars.length > 0 && <span>bar: {r.bars.map((x) => ROLE_LETTER[x]).join("")}</span>}
                            <span>
                              in {r.inn.length + r.embedsIn.length} · out {r.out.length}
                            </span>
                            {r.p7 && <span className="font-semibold text-warn">P7 {r.p7}</span>}
                            {noWay(r) && <span className="font-semibold text-danger">no way in</span>}
                          </div>
                        </button>
                        {open && picked && <Detail r={picked} colorOf={colorOf} nameOf={nameOf} jump={jump} />}
                      </Card>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {groups.length === 0 && <p className="text-sm text-neutral-500">No page matches.</p>}
      </div>

      <div className="mt-8">
        <SectionLabel>Old routes that redirect</SectionLabel>
        <Card pad={false}>
          <ul className="divide-y divide-line-soft text-sm">
            {MAP.redirects.map((r) => (
              <li key={r.from} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="font-mono text-xs text-neutral-500">{r.from}</span>
                <span aria-hidden>→</span>
                <Chipish color={colorOf(r.to.split("?")[0])} label={nameOf(r.to.split("?")[0])} extra={r.to.includes("?") ? r.to.split("?")[1] : ""} onClick={() => jump(r.to.split("?")[0])} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Chipish({ color, label, extra, onClick, dashed }: { color: string; label: string; extra?: string; onClick: () => void; dashed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-pill border px-2.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
      style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
    >
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
      {extra ? <span className="text-neutral-500">?{extra}</span> : null}
    </button>
  );
}

function Detail({
  r,
  colorOf,
  nameOf,
  jump,
}: {
  r: Row;
  colorOf: (route: string) => string;
  nameOf: (route: string) => string;
  jump: (route: string) => void;
}) {
  const kindMark = (k: Link["kind"]) => (k === "redirect" ? " (redirects)" : k === "push" ? " (after an action)" : k === "strip" ? " (tab strip)" : "");
  return (
    <div className="grid gap-4 border-t border-line-soft px-3 py-3 pad:grid-cols-2">
      <div>
        <SectionLabel>Opens ({r.out.length + r.embedsOut.length})</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {r.out.map((l) => (
            <Chipish key={l.to} color={colorOf(l.to)} label={nameOf(l.to) + kindMark(l.kind)} extra={l.q?.join(", ")} onClick={() => jump(l.to)} />
          ))}
          {r.embedsOut.map((to) => (
            <Chipish key={"e" + to} dashed color={colorOf(to)} label={nameOf(to) + " (drawn inside)"} onClick={() => jump(to)} />
          ))}
          {r.out.length + r.embedsOut.length === 0 && <span className="text-sm text-neutral-500">Dead end. Only the menu and back lead away.</span>}
        </div>
      </div>
      <div>
        <SectionLabel>How a person gets here</SectionLabel>
        <ul className="mb-2 space-y-0.5 text-sm">
          <li>{r.menu ? `☰ menu: ${r.wsTitle}` : "Not a row in the ☰ menu"}</li>
          {r.bars.length > 0 && <li>Bottom bar for {r.bars.map((x) => ROLE_NAME[x]).join(", ")}</li>}
          {r.searchOnly && <li className="text-neutral-500">{r.searchOnly}</li>}
          {r.redirectsIn.length > 0 && <li className="text-neutral-500">Old routes: {r.redirectsIn.join(", ")}</li>}
          <li className="text-neutral-500">
            Gate: {r.view ?? "none"} · file {MAP.pages.find((p) => p.route === r.route)?.file}
          </li>
        </ul>
        <SectionLabel>Linked from ({r.inn.length + r.embedsIn.length})</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {r.inn.map((l) => (
            <Chipish key={l.from} color={colorOf(l.from)} label={nameOf(l.from)} extra={l.q?.join(", ")} onClick={() => jump(l.from)} />
          ))}
          {r.embedsIn.map((from) => (
            <Chipish key={"e" + from} dashed color={colorOf(from)} label={nameOf(from) + " (draws it)"} onClick={() => jump(from)} />
          ))}
          {r.inn.length + r.embedsIn.length === 0 && <span className="text-sm text-neutral-500">No other page links here.</span>}
        </div>
      </div>
    </div>
  );
}
