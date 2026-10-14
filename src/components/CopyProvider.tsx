"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { resolveCopy } from "@/lib/copy";

/**
 * Provides the resolved page-copy overrides to client components. Fed by the
 * server layout (which reads `page_copy` once per request), so a page renders
 * edited wording with no client round-trip and no flash of the old text.
 *
 * Deliberately shaped like AccessProvider/useAccess — see src/lib/copy.ts for
 * the override model and src/app/layout.tsx for where it's mounted.
 *
 * Usage in a client component:
 *   const c = useCopy();
 *   <PageHeader title={c("page.jobs.title")} />
 *
 * EDIT IN PLACE (admin only, `canEdit`): the overrides are held in state so a
 * save from CopyInPlace re-renders every `c()` at once, and `c()` records what
 * it rendered for each key (`rendered`) so the editor can find that text on
 * the page. `editing` is per device, kept in localStorage like the theme.
 */
interface CopyContextValue {
  overrides: Record<string, string>;
  setOverride: (key: string, value: string | null) => void;
  /** key → the text c() last rendered for it, tokens filled. Admins only. */
  rendered: Map<string, string>;
  canEdit: boolean;
  editing: boolean;
  setEditing: (on: boolean) => void;
}

const EDIT_KEY = "copyEdit";

const CopyContext = createContext<CopyContextValue>({
  overrides: {},
  setOverride: () => {},
  rendered: new Map(),
  canEdit: false,
  editing: false,
  setEditing: () => {},
});

export function CopyProvider({
  overrides: initial,
  canEdit = false,
  children,
}: {
  overrides: Record<string, string>;
  canEdit?: boolean;
  children: ReactNode;
}) {
  // A server refresh brings a new set; take it (same joined-key trick
  // AccessProvider uses, so an unchanged set is not a new render).
  const key = JSON.stringify(initial);
  const [overrides, setOverrides] = useState(initial);
  useEffect(() => {
    setOverrides(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [editing, setEditingState] = useState(false);
  useEffect(() => {
    if (!canEdit) return;
    try {
      setEditingState(localStorage.getItem(EDIT_KEY) === "1");
    } catch {
      /* storage blocked — starts off */
    }
  }, [canEdit]);

  const rendered = useRef(new Map<string, string>()).current;

  const value = useMemo<CopyContextValue>(
    () => ({
      overrides,
      setOverride: (k, v) =>
        setOverrides((was) => {
          const next = { ...was };
          if (v === null) delete next[k];
          else next[k] = v;
          return next;
        }),
      rendered,
      canEdit,
      editing: canEdit && editing,
      setEditing: (on) => {
        setEditingState(on);
        try {
          if (on) localStorage.setItem(EDIT_KEY, "1");
          else localStorage.removeItem(EDIT_KEY);
        } catch {
          /* storage blocked — this visit only */
        }
      },
    }),
    [overrides, rendered, canEdit, editing],
  );
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>;
}

/**
 * Returns `c(key, vars?)` — the edited text for a registry key, or the shipped
 * English when there's no override. An unknown key returns "" rather than the
 * raw id, so a stale key can never render `home.dest.foo.label` at a user.
 *
 * `vars` fills `{token}` placeholders: `c("recode.empty.nothingToStage",
 * { month: monthLabel })`.
 */
export function useCopy(): (key: string, vars?: Record<string, string | number>) => string {
  const { overrides, rendered, canEdit } = useContext(CopyContext);
  return useMemo(
    () => (key: string, vars?: Record<string, string | number>) => {
      const text = resolveCopy(overrides, key, vars);
      if (canEdit && text) rendered.set(key, text);
      return text;
    },
    [overrides, rendered, canEdit],
  );
}

/** The edit-in-place controls: CopyInPlace and the menu's switch. */
export function useCopyEdit() {
  return useContext(CopyContext);
}
