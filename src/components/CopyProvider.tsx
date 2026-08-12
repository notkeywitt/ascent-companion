"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
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
 */
const CopyContext = createContext<Record<string, string>>({});

export function CopyProvider({
  overrides,
  children,
}: {
  overrides: Record<string, string>;
  children: ReactNode;
}) {
  // Re-memo only when the override set actually changes, not on every render of
  // the layout (same trick AccessProvider uses with its joined key).
  const key = JSON.stringify(overrides);
  const value = useMemo(
    () => overrides,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>;
}

/**
 * Returns `c(key)` — the edited text for a registry key, or the shipped English
 * when there's no override. An unknown key returns "" rather than the raw id, so
 * a stale key can never render `home.dest.foo.label` at a user.
 */
export function useCopy(): (key: string) => string {
  const overrides = useContext(CopyContext);
  return useMemo(() => (key: string) => resolveCopy(overrides, key), [overrides]);
}
