"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Role } from "@/lib/views";

interface Access {
  role: Role;
  views: Set<string>;
  /** True if the current user may see the given view id. */
  can: (viewId: string) => boolean;
}

const AccessContext = createContext<Access>({
  role: "field",
  views: new Set<string>(),
  can: () => false,
});

/**
 * Provides the signed-in user's role + resolved view set to client nav. Fed by
 * the server layout (which reads the session), so the nav filters without an
 * extra client round-trip. See src/app/layout.tsx and src/lib/views.ts.
 */
export function AccessProvider({
  role,
  views,
  children,
}: {
  role: Role;
  views: string[];
  children: ReactNode;
}) {
  const key = views.join("|");
  const value = useMemo<Access>(() => {
    const set = new Set(views);
    return { role, views: set, can: (id) => set.has(id) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, key]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): Access {
  return useContext(AccessContext);
}
