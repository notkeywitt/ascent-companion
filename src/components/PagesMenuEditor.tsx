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
  btn,
} from "@/components/ui";
import type { PageEntry, PagesMenuGroup } from "@/lib/pagesMenu";

/**
 * The All Pages menu's EDIT mode — the admin arranges the ORDER and the
 * GROUPING: rename a group, move a group, move a page into another group, move
 * a page within its group. Writes the whole menu as one document to
 * /api/admin/pages-menu; the menu re-reads it after save (it is server-rendered
 * — see src/lib/pagesMenu.ts for the override model).
 *
 * WHAT IT DELIBERATELY CANNOT DO IS HIDE A PAGE. This menu's promise is that
 * every page is in it; who may open one is `views.ts` and the per-user grants on
 * /admin, not a layout. So there is no delete for a page, a group can only be
 * deleted once it is empty, and a page added to the app after a save appears in
 * the menu on its own.
 *
 * Ordering is up/down buttons, not drag — reliable under a thumb, which is where
 * this app is used. Same choice as HomeLayoutEditor.
 */

function newId(): string {
  try {
    return `group-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `group-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function PagesMenuEditor({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [groups, setGroups] = useState<PagesMenuGroup[]>([]);
  const [catalog, setCatalog] = useState<Record<string, PageEntry>>({});
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  /** Which row has its "move to another group" picker open. */
  const [moving, setMoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pages-menu");
      if (!res.ok)
        throw new Error(res.status === 403 ? "Admins only." : `Load failed (${res.status})`);
      const json = (await res.json()) as {
        layout: { groups: PagesMenuGroup[] };
        isCustom: boolean;
        catalog: PageEntry[];
      };
      setGroups(json.layout.groups);
      setCatalog(Object.fromEntries(json.catalog.map((p) => [p.view, p])));
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

  const rename = (id: string, title: string) =>
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, title } : g)));

  const moveGroup = (idx: number, dir: -1 | 1) => setGroups((gs) => move(gs, idx, idx + dir));

  const addGroup = () => setGroups((gs) => [...gs, { id: newId(), title: "New group", views: [] }]);

  const deleteGroup = (id: string) => setGroups((gs) => gs.filter((g) => g.id !== id));

  const movePage = (groupId: string, idx: number, dir: -1 | 1) =>
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, views: move(g.views, idx, idx + dir) } : g)),
    );

  /** Move one page into another group, at the end of it. */
  const reassign = (fromId: string, view: string, toId: string) => {
    setMoving(null);
    if (fromId === toId) return;
    setGroups((gs) =>
      gs.map((g) => {
        if (g.id === fromId) return { ...g, views: g.views.filter((v) => v !== view) };
        if (g.id === toId) return { ...g, views: [...g.views, view] };
        return g;
      }),
    );
  };

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pages-menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: { version: 1, groups } }),
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
    if (!confirm("Put back the original grouping? Your changes will be discarded.")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pages-menu", { method: "DELETE" });
      if (!res.ok) throw new Error(`Revert failed (${res.status})`);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revert failed");
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading the menu…" />;

  return (
    <div className="space-y-4">
      <Banner tone="info">
        Arrange the All Pages menu: rename a group, reorder with the arrows, and move a page to
        another group. Every page stays in the menu — who can open one is set on Admin. Nothing
        changes for anyone until you tap <strong>Save</strong>.
      </Banner>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="space-y-4">
        {groups.map((group, gi) => (
          <Card key={group.id} className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor={`group-${group.id}`}>Group name</Label>
                <Input
                  id={`group-${group.id}`}
                  value={group.title}
                  placeholder="Group name"
                  onChange={(e) => rename(group.id, e.target.value)}
                />
              </div>
              <div className="flex shrink-0 flex-col items-center">
                <IconButton label="Move group up" disabled={gi === 0} onClick={() => moveGroup(gi, -1)}>
                  ↑
                </IconButton>
                <IconButton
                  label="Move group down"
                  disabled={gi === groups.length - 1}
                  onClick={() => moveGroup(gi, 1)}
                >
                  ↓
                </IconButton>
                <IconButton
                  label="Delete group"
                  tone="danger"
                  // An empty group only: a page cannot be deleted here, so a
                  // group with pages in it has to be emptied first — which is
                  // what stops a page quietly leaving the menu.
                  disabled={group.views.length > 0}
                  title={
                    group.views.length > 0
                      ? "Move its pages to another group first"
                      : "Delete group"
                  }
                  onClick={() => deleteGroup(group.id)}
                >
                  ✕
                </IconButton>
              </div>
            </div>

            <div className="space-y-1.5">
              {group.views.map((view, pi) => {
                const page = catalog[view];
                const isMoving = moving === view;
                return (
                  <div key={view} className="rounded-lg border border-line-soft">
                    <div className="flex items-center gap-1 px-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {page?.label ?? view}
                      </span>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setMoving(isMoving ? null : view)}
                          className="shrink-0 px-1 text-[11px] font-semibold text-accent hover:underline dark:text-accent-soft"
                        >
                          {isMoving ? "Done" : "Move"}
                        </button>
                      )}
                      <IconButton
                        label="Move up"
                        disabled={pi === 0}
                        onClick={() => movePage(group.id, pi, -1)}
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        label="Move down"
                        disabled={pi === group.views.length - 1}
                        onClick={() => movePage(group.id, pi, 1)}
                      >
                        ↓
                      </IconButton>
                    </div>

                    {isMoving && (
                      <div className="border-t border-line-soft px-2 py-2">
                        <Label htmlFor={`to-${view}`}>In group</Label>
                        <Select
                          id={`to-${view}`}
                          value={group.id}
                          onChange={(e) => reassign(group.id, view, e.target.value)}
                        >
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title || "Untitled group"}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}

              {group.views.length === 0 && (
                <p className="px-1 text-xs text-neutral-500">
                  No pages here — move one in, or delete the group.
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>

      <button type="button" onClick={addGroup} className={btn("secondary", "md", "w-full")}>
        + Add a group
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
