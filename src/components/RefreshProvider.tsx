"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

/**
 * App-wide "reload the data" mechanism.
 *
 * The Assistant's pages each fetch their own data from /api/* on mount, so there
 * is no single client store to invalidate. Rather than teach every page a
 * refresh signal, this provider remounts the whole page subtree on demand:
 * `RefreshBoundary` wraps {children} with a key that bumps whenever `refresh()`
 * runs, which re-runs every page's mount-time fetch. `router.refresh()` covers
 * anything server-rendered (root-layout session/role, server pages) in the same
 * call, so both halves of the page reload from one button.
 *
 * The header's <RefreshButton> is the trigger, but any component can call
 * useRefresh() to reload the current page's data.
 */
type RefreshCtx = {
  /** Reload the current page's data (client re-fetch + server refresh). */
  refresh: () => void;
  /** True while the server refresh is in flight. */
  refreshing: boolean;
  /** Remount counter — RefreshBoundary keys the page subtree on it. */
  nonce: number;
};

const Ctx = createContext<RefreshCtx | null>(null);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [nonce, setNonce] = useState(0);
  const [refreshing, startTransition] = useTransition();

  const refresh = useCallback(() => {
    // Re-fetch server-rendered data (root-layout session, any server pages)…
    startTransition(() => router.refresh());
    // …and remount the client page subtree so its mount-time fetches re-run.
    setNonce((n) => n + 1);
  }, [router]);

  return <Ctx.Provider value={{ refresh, refreshing, nonce }}>{children}</Ctx.Provider>;
}

export function useRefresh(): RefreshCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRefresh must be used within <RefreshProvider>");
  return c;
}

/**
 * Wraps the page content and remounts it whenever `refresh()` runs. `display:
 * contents` (Tailwind `contents`) so the wrapper contributes no box of its own —
 * the page lays out exactly as if it weren't here.
 */
export function RefreshBoundary({ children }: { children: ReactNode }) {
  const { nonce } = useRefresh();
  return (
    <div key={nonce} className="contents">
      {children}
    </div>
  );
}
