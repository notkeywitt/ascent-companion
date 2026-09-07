"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Banner,
  Button,
  Card,
  IconButton,
  Input,
  Label,
  Loading,
  Select,
  Toggle,
  btn,
} from "@/components/ui";
import {
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  clampColumns,
  type NavItem,
  type NavItemKind,
  type NavMenu,
} from "@/lib/navLayout";

/**
 * The admin home launcher's EDIT mode — arrange, create, name, and delete
 * menus, their page links, and buttons. Writes the whole launcher as one
 * document to /api/admin/home-layout; the home page re-reads it after save (see
 * src/lib/navLayout.ts for the override model).
 *
 * Self-contained: it fetches its own fresh copy of the layout plus the catalog
 * of gate ids on open, so it never drifts from what the page is showing. Save
 * refreshes the router (the layout is server-rendered) and closes; Cancel
 * discards the draft.
 *
 * Ordering is done with up/down buttons rather than drag — reliable under a
 * thumb, which is where this app is used.
 *
 * TWO THINGS ARE NOT MENUS. "Menus per row" is how many menus sit side by side
 * once the page is full width (xl), and the FIRST card is the top-button
 * bucket — buttons that belong to no menu, across the top of the launcher.
 * That bucket is carried in this editor's `menus` array as a pseudo-menu with
 * the id TOP, so every existing edit, move and reassign handler works on it
 * unchanged; save() lifts it back out into `layout.items`.
 */

/** Id of the pseudo-menu that holds the buttons outside every menu. */
const TOP = "__top__";

interface ViewOpt {
  id: string;
  label: string;
  href: string;
}

/** A fresh unique id for a new menu or item. */
function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function HomeLayoutEditor({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [views, setViews] = useState<ViewOpt[]>([]);
  const [menus, setMenus] = useState<NavMenu[]>([]);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/home-layout");
      if (!res.ok)
        throw new Error(res.status === 403 ? "Admins only." : `Load failed (${res.status})`);
      const json = (await res.json()) as {
        layout: { menus: NavMenu[]; items?: NavItem[]; columns?: number };
        isCustom: boolean;
        views: ViewOpt[];
      };
      // The top buttons ride along as the first pseudo-menu (see TOP above).
      setMenus([
        { id: TOP, title: "Buttons (no menu)", blurb: "", items: json.layout.items ?? [] },
        ...json.layout.menus,
      ]);
      setColumns(clampColumns(json.layout.columns));
      setViews(json.views);
      setIsCustom(json.isCustom);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── menu-level edits ──────────────────────────────────────────────────────
  const patchMenu = (menuId: string, patch: Partial<NavMenu>) =>
    setMenus((ms) => ms.map((m) => (m.id === menuId ? { ...m, ...patch } : m)));

  const moveMenu = (idx: number, dir: -1 | 1) => setMenus((ms) => move(ms, idx, idx + dir));

  const addMenu = () =>
    setMenus((ms) => [...ms, { id: newId("menu"), title: "New menu", blurb: "", items: [] }]);

  const deleteMenu = (menuId: string) => setMenus((ms) => ms.filter((m) => m.id !== menuId));

  // ── item-level edits ──────────────────────────────────────────────────────
  const patchItem = (menuId: string, itemId: string, patch: Partial<NavItem>) =>
    setMenus((ms) =>
      ms.map((m) =>
        m.id === menuId
          ? { ...m, items: m.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
          : m,
      ),
    );

  const moveItem = (menuId: string, idx: number, dir: -1 | 1) =>
    setMenus((ms) =>
      ms.map((m) => (m.id === menuId ? { ...m, items: move(m.items, idx, idx + dir) } : m)),
    );

  const deleteItem = (menuId: string, itemId: string) =>
    setMenus((ms) =>
      ms.map((m) =>
        m.id === menuId ? { ...m, items: m.items.filter((it) => it.id !== itemId) } : m,
      ),
    );

  const addItem = (menuId: string, kind: NavItemKind) => {
    const id = newId("item");
    setMenus((ms) =>
      ms.map((m) =>
        m.id === menuId
          ? { ...m, items: [...m.items, { id, kind, label: "", href: "", desc: "", view: "" }] }
          : m,
      ),
    );
    setEditingItem(id);
  };

  /** Move an item to a different menu, keeping its edit box open. */
  const reassignItem = (fromMenuId: string, itemId: string, toMenuId: string) => {
    if (fromMenuId === toMenuId) return;
    setMenus((ms) => {
      const item = ms.find((m) => m.id === fromMenuId)?.items.find((it) => it.id === itemId);
      if (!item) return ms;
      // Outside a menu, only a button makes sense — nothing labels a bare row.
      const moved = toMenuId === TOP ? { ...item, kind: "button" as const } : item;
      return ms.map((m) => {
        if (m.id === fromMenuId) return { ...m, items: m.items.filter((it) => it.id !== itemId) };
        if (m.id === toMenuId) return { ...m, items: [...m.items, moved] };
        return m;
      });
    });
  };

  /** Picking a page from the catalog fills a blank label/href/desc for you. */
  const pickView = (menuId: string, item: NavItem, viewId: string) => {
    if (viewId === "") {
      patchItem(menuId, item.id, { view: "" });
      return;
    }
    const v = views.find((x) => x.id === viewId);
    if (!v) return;
    patchItem(menuId, item.id, {
      view: v.id,
      href: item.href.trim() === "" ? v.href : item.href,
      label: item.label.trim() === "" ? v.label : item.label,
    });
  };

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/home-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout: {
            version: 1,
            columns,
            // Lift the pseudo-menu back out: its items are the top buttons.
            items: menus.find((m) => m.id === TOP)?.items ?? [],
            menus: menus.filter((m) => m.id !== TOP),
          },
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  }

  async function revert() {
    if (!confirm("Put back the original menus? Your customizations will be discarded.")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/home-layout", { method: "DELETE" });
      if (!res.ok) throw new Error(`Revert failed (${res.status})`);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revert failed");
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading the launcher…" />;

  return (
    <div className="space-y-4">
      <Banner tone="info">
        Arrange your home page: choose how many menus sit side by side on a wide screen, put buttons
        above the menus or inside them, rename menus, and reorder with the arrows. Nothing changes
        for anyone until you tap <strong>Save</strong>.
      </Banner>

      {error && <Banner tone="error">{error}</Banner>}

      {/* Page-level choice: how wide the launcher lays out on a big screen.
          The field is narrowed by a WRAPPER, not by a class on <Select>:
          inputCls carries `w-full`, and Tailwind resolves two width utilities
          by stylesheet order, so a `w-20` on the control loses and the row's
          text column gets crushed to one word per line. */}
      <Card className="space-y-2">
        <div>
          <Label htmlFor="columns">Menus per row (wide screens)</Label>
          <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
            A phone always shows one. This is the desktop layout.
          </p>
        </div>
        <div className="w-24">
          <Select
            id="columns"
            value={String(columns)}
            onChange={(e) => setColumns(clampColumns(Number(e.target.value)))}
          >
            {Array.from({ length: MAX_COLUMNS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <div className="space-y-4">
        {menus.map((menu, mi) => {
          // The first card is the top-button bucket, not a menu: it has no name,
          // no description, no position, and holds only buttons.
          const isTop = menu.id === TOP;
          return (
            <Card key={menu.id} className="space-y-3">
              {/* Menu header — name, blurb, and menu-level controls. The bucket
                has none of those: it is one fixed row at the top of the page. */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  {isTop ? (
                    <div>
                      <p className="text-sm font-semibold">Buttons outside every menu</p>
                      <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                        A row of big buttons across the top of the home page, above the menus. Leave
                        it empty for none.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <Label htmlFor={`title-${menu.id}`}>Menu name</Label>
                        <Input
                          id={`title-${menu.id}`}
                          value={menu.title}
                          placeholder="Menu name"
                          onChange={(e) => patchMenu(menu.id, { title: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`blurb-${menu.id}`}>Description (optional)</Label>
                        <Input
                          id={`blurb-${menu.id}`}
                          value={menu.blurb}
                          placeholder="Short description"
                          onChange={(e) => patchMenu(menu.id, { blurb: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className={`flex shrink-0 flex-col items-center ${isTop ? "hidden" : ""}`}>
                  <IconButton
                    label="Move menu up"
                    disabled={mi <= 1}
                    onClick={() => moveMenu(mi, -1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label="Move menu down"
                    disabled={mi === menus.length - 1}
                    onClick={() => moveMenu(mi, 1)}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    label="Delete menu"
                    tone="danger"
                    onClick={() => {
                      if (
                        menu.items.length === 0 ||
                        confirm(
                          `Delete the "${menu.title}" menu and its ${menu.items.length} item(s)?`,
                        )
                      )
                        deleteMenu(menu.id);
                    }}
                  >
                    ✕
                  </IconButton>
                </div>
              </div>

              {/* Items — links and buttons in this menu, in order. */}
              <div className="space-y-2">
                {menu.items.map((item, ii) => {
                  const isEditing = editingItem === item.id;
                  return (
                    <div key={item.id} className="rounded-lg border border-line-soft">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            item.kind === "button"
                              ? "bg-accent/15 text-accent dark:text-accent-soft"
                              : "bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-neutral-400"
                          }`}
                        >
                          {item.kind}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {item.label || <span className="text-neutral-400">Untitled</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingItem(isEditing ? null : item.id)}
                          className="shrink-0 text-[11px] font-semibold text-accent hover:underline dark:text-accent-soft"
                        >
                          {isEditing ? "Done" : "Edit"}
                        </button>
                        <IconButton
                          label="Move up"
                          disabled={ii === 0}
                          onClick={() => moveItem(menu.id, ii, -1)}
                        >
                          ↑
                        </IconButton>
                        <IconButton
                          label="Move down"
                          disabled={ii === menu.items.length - 1}
                          onClick={() => moveItem(menu.id, ii, 1)}
                        >
                          ↓
                        </IconButton>
                        <IconButton
                          label="Delete item"
                          tone="danger"
                          onClick={() => deleteItem(menu.id, item.id)}
                        >
                          ✕
                        </IconButton>
                      </div>

                      {isEditing && (
                        <div className="space-y-2 border-t border-line-soft px-2 py-2.5">
                          {!isTop && (
                            <Toggle
                              checked={item.kind === "button"}
                              onChange={(on) =>
                                patchItem(menu.id, item.id, { kind: on ? "button" : "link" })
                              }
                              label="Show as a big button"
                            />
                          )}
                          <div>
                            <Label htmlFor={`view-${item.id}`}>Links to a page</Label>
                            <Select
                              id={`view-${item.id}`}
                              value={item.view}
                              onChange={(e) => pickView(menu.id, item, e.target.value)}
                            >
                              <option value="">Custom link (type the address below)</option>
                              {views.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.label}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`label-${item.id}`}>Name</Label>
                            <Input
                              id={`label-${item.id}`}
                              value={item.label}
                              placeholder="What it's called"
                              onChange={(e) =>
                                patchItem(menu.id, item.id, { label: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <Label htmlFor={`href-${item.id}`}>Address</Label>
                            <Input
                              id={`href-${item.id}`}
                              value={item.href}
                              placeholder="/page or https://…"
                              onChange={(e) =>
                                patchItem(menu.id, item.id, { href: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <Label htmlFor={`desc-${item.id}`}>Description (optional)</Label>
                            <Input
                              id={`desc-${item.id}`}
                              value={item.desc}
                              placeholder="Second line under the name"
                              onChange={(e) =>
                                patchItem(menu.id, item.id, { desc: e.target.value })
                              }
                            />
                          </div>
                          {menus.length > 1 && (
                            <div>
                              <Label htmlFor={`menu-${item.id}`}>In menu</Label>
                              <Select
                                id={`menu-${item.id}`}
                                value={menu.id}
                                onChange={(e) => {
                                  reassignItem(menu.id, item.id, e.target.value);
                                  setEditingItem(null);
                                }}
                              >
                                {menus.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.id === TOP
                                      ? "No menu — top buttons"
                                      : m.title || "Untitled menu"}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {menu.items.length === 0 && (
                  <p className="px-1 text-xs text-neutral-500">
                    {isTop
                      ? "No buttons here — the top row is off."
                      : "No items yet — add a link or a button."}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  {!isTop && (
                    <Button variant="outline" size="sm" onClick={() => addItem(menu.id, "link")}>
                      + Page link
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => addItem(menu.id, "button")}>
                    + Button
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <button type="button" onClick={addMenu} className={btn("secondary", "md", "w-full")}>
        + Add a menu
      </button>

      {/* Commit / cancel. Docked-feeling row at the bottom of the editor. */}
      <div className="sticky bottom-[calc(var(--tabbar-h)+0.5rem)] z-10 mt-4 flex items-center gap-2 rounded-xl border border-line bg-white/95 p-2 backdrop-blur dark:bg-ink-raised/95">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        {isCustom && (
          <button
            type="button"
            onClick={() => void revert()}
            disabled={saving}
            className="ml-auto text-xs text-neutral-500 underline disabled:opacity-50"
          >
            Revert to original
          </button>
        )}
      </div>
    </div>
  );
}
