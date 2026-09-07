"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { clampColumns, defaultLayout, type NavItem, type NavLayout } from "@/lib/navLayout";

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
}

const NavLayoutContext = createContext<NavLayoutValue>({ custom: null });

export function NavLayoutProvider({
  layout,
  children,
}: {
  layout: NavLayout | null;
  children: ReactNode;
}) {
  // Re-memo only when the layout actually changes (same trick CopyProvider uses).
  const key = layout ? JSON.stringify(layout) : "";
  const value = useMemo<NavLayoutValue>(
    () => ({ custom: layout }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
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
