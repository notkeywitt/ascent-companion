"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { clampColumns, defaultLayout, type NavItem, type NavLayout } from "@/lib/navLayout";
import { resolvePagesMenu, type PageEntry, type PagesMenuLayout } from "@/lib/pagesMenu";

/**
 * Provides the admin home launcher's layout to client components. Fed by the
 * server layout (which reads `nav_layout` once per request), so the home page
 * renders the customized launcher with no client round-trip and no flash of the
 * shipped one.
 *
 * Shaped like CopyProvider/useCopy — see src/lib/navLayout.ts for the override
 * model and src/app/layout.tsx for where it's mounted.
 *
 * `custom` is null when no saved layout exists; the page then renders the
 * shipped AREAS default AND keeps resolving its wording through the copy
 * registry (office edits still apply). Once a layout is saved, its own strings
 * are authoritative — the Edit surface is the naming surface.
 */
interface NavLayoutValue {
  /** The saved layout, or null when the shipped default is in effect. */
  custom: NavLayout | null;
  /** The saved All Pages grouping, or null for the shipped one. */
  pagesMenu: PagesMenuLayout | null;
}

const NavLayoutContext = createContext<NavLayoutValue>({ custom: null, pagesMenu: null });

export function NavLayoutProvider({
  layout,
  pagesMenu = null,
  children,
}: {
  layout: NavLayout | null;
  pagesMenu?: PagesMenuLayout | null;
  children: ReactNode;
}) {
  // Re-memo only when a layout actually changes (same trick CopyProvider uses).
  const key = layout ? JSON.stringify(layout) : "";
  const pagesKey = pagesMenu ? JSON.stringify(pagesMenu) : "";
  const value = useMemo<NavLayoutValue>(
    () => ({ custom: layout, pagesMenu }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, pagesKey],
  );
  return <NavLayoutContext.Provider value={value}>{children}</NavLayoutContext.Provider>;
}

export function useNavLayout(): NavLayoutValue {
  return useContext(NavLayoutContext);
}

/**
 * The effective launcher: the saved layout, or the shipped AREAS default.
 * `items` are the buttons that belong to no menu (the launcher's top row) and
 * `columns` is how many menus sit side by side once the page is full width.
 */
export function useEffectiveLayout(): {
  menus: NavLayout["menus"];
  items: NavItem[];
  columns: number;
  isCustom: boolean;
} {
  const { custom } = useNavLayout();
  return useMemo(() => {
    const layout = custom ?? defaultLayout();
    return {
      menus: layout.menus,
      items: layout.items ?? [],
      columns: clampColumns(layout.columns),
      isCustom: custom !== null,
    };
  }, [custom]);
}

/**
 * The All Pages menu as it renders — the admin's saved order and grouping, or
 * the shipped one, with any page added since it was saved folded back in (see
 * `resolvePagesMenu`). `isCustom` is what tells the menu's Edit mode whether
 * "Revert to original" has anything to revert.
 */
export function usePagesMenu(): {
  groups: { id: string; title: string; pages: PageEntry[] }[];
  isCustom: boolean;
} {
  const { pagesMenu } = useNavLayout();
  return useMemo(
    () => ({ groups: resolvePagesMenu(pagesMenu), isCustom: pagesMenu !== null }),
    [pagesMenu],
  );
}
