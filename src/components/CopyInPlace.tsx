"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Banner, Button, Textarea } from "@/components/ui";
import { useCopyEdit } from "@/components/CopyProvider";
import { COPY, resolveCopy } from "@/lib/copy";

/**
 * Admin → edit page text IN PLACE. While "Edit page text" is on (the ☰ menu or
 * the sidebar's Account panel), every piece of registry text on the page gets a
 * dashed outline; tapping one opens a small editor beside it that saves through
 * /api/admin/copy, the same route Admin → Page Text uses.
 *
 * HOW IT FINDS THE TEXT: `c()` records what it rendered for each key
 * (CopyProvider's `rendered`). This walks the page and tags every text node,
 * placeholder or title that reads EXACTLY one of those strings with
 * `data-copy-key`. A string stitched into a longer sentence is not its own
 * node, so it is not tagged — Admin → Page Text still lists it. Two keys that
 * render the same words both open, each with its own field.
 *
 * Only text in the registry (src/lib/copy.ts) can be edited; everything else on
 * a page is code.
 */
const ATTRS = ["placeholder", "title", "aria-label"] as const;

interface Open {
  keys: string[];
  rect: DOMRect;
}

export function CopyInPlace() {
  const { editing, setEditing, rendered } = useCopyEdit();
  const [open, setOpen] = useState<Open | null>(null);

  // Tag the page, and re-tag whenever it changes.
  useEffect(() => {
    if (!editing) return;
    let frame = 0;
    const mark = () => {
      frame = 0;
      const byText = new Map<string, string[]>();
      for (const [k, t] of rendered) {
        const s = t.trim();
        if (s.length < 2) continue;
        byText.set(s, [...(byText.get(s) ?? []), k]);
      }
      const tag = (el: Element | null, keys: string[] | undefined) => {
        if (!el || !keys || el.closest("[data-copy-editor]")) return;
        el.setAttribute("data-copy-key", keys.join(" "));
      };
      document
        .querySelectorAll("[data-copy-key]")
        .forEach((el) => el.removeAttribute("data-copy-key"));
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        tag(n.parentElement, byText.get((n.nodeValue ?? "").trim()));
      }
      for (const a of ATTRS) {
        document
          .querySelectorAll(`[${a}]`)
          .forEach((el) => tag(el, byText.get((el.getAttribute(a) ?? "").trim())));
      }
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(mark);
    };
    mark();
    // Not `attributes`: our own tagging would wake it forever.
    const obs = new MutationObserver(later);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      if (frame) cancelAnimationFrame(frame);
      document
        .querySelectorAll("[data-copy-key]")
        .forEach((el) => el.removeAttribute("data-copy-key"));
    };
  }, [editing, rendered]);

  // A tap on tagged text opens the editor INSTEAD of whatever it would do — a
  // link's label must not navigate away mid-edit. Window capture runs before
  // React's own listeners, so stopping it here is enough.
  useEffect(() => {
    if (!editing) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || t.closest("[data-copy-editor]")) return;
      const el = t.closest("[data-copy-key]");
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen({
        keys: (el.getAttribute("data-copy-key") ?? "").split(" "),
        rect: el.getBoundingClientRect(),
      });
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [editing]);

  useEffect(() => {
    if (!editing) setOpen(null);
  }, [editing]);

  if (!editing) return null;

  return createPortal(
    <div data-copy-editor>
      <style>{`[data-copy-key]{outline:1px dashed currentColor;outline-offset:2px;cursor:text}`}</style>

      {/* The mode's own bar, so it is never left on by accident. */}
      <div
        className="fixed right-3 z-50 flex items-center gap-3 rounded-full border border-line bg-white py-1.5 pl-4 pr-1.5 text-xs shadow-lg dark:bg-ink-raised print:hidden"
        style={{ bottom: "calc(var(--tabbar-h, 0px) + 12px)" }}
      >
        <span className="text-neutral-600 dark:text-neutral-300">
          Editing page text — tap outlined text
        </span>
        <Button size="sm" onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>

      {open && <Editor key={open.keys.join(" ")} open={open} onClose={() => setOpen(null)} />}
    </div>,
    document.body,
  );
}

function Editor({ open, onClose }: { open: Open; onClose: () => void }) {
  const { overrides, setOverride } = useCopyEdit();
  const keys = open.keys.filter((k) => k in COPY);
  // Raw text, tokens unfilled — what the person types into.
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(keys.map((k) => [k, resolveCopy(overrides, k)])),
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Save one key. A blank value is the route's "revert to default".
  const save = async (key: string, value: string) => {
    setBusy(key);
    setError("");
    try {
      const r = await fetch("/api/admin/copy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      setOverride(key, j.overridden ? j.value : null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  };

  // Below the text, or above it when it sits low on the screen.
  const low = open.rect.bottom > window.innerHeight * 0.6;
  const left = Math.max(8, Math.min(open.rect.left, window.innerWidth - 348));
  const pos = low
    ? { bottom: window.innerHeight - open.rect.top + 6, left }
    : { top: open.rect.bottom + 6, left };

  return (
    <>
      <button
        type="button"
        aria-label="Close editor"
        onClick={onClose}
        className="fixed inset-0 z-50 cursor-default"
      />
      <div
        role="dialog"
        aria-label="Edit text"
        className="fixed z-50 w-[min(340px,calc(100vw-16px))] space-y-3 rounded-xl border border-line bg-white p-3 shadow-xl dark:bg-ink-raised"
        style={pos}
      >
        {keys.map((k) => {
          const entry = COPY[k];
          return (
            <div key={k} className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {entry.label}
              </div>
              <Textarea
                autoFocus={k === keys[0]}
                rows={entry.short ? 1 : 3}
                value={draft[k] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
              {entry.tokens?.length ? (
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Keep {entry.tokens.map((t) => `{${t}}`).join(", ")}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!!busy} onClick={() => save(k, draft[k] ?? "")}>
                  {busy === k ? "Saving…" : "Save"}
                </Button>
                {overrides[k] !== undefined && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() => save(k, "")}
                  >
                    Reset to default
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {error && <Banner tone="error">{error}</Banner>}
      </div>
    </>
  );
}
