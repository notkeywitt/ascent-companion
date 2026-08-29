"use client";

import { ROLE_LABEL } from "@/lib/preview";
import { stopPreview, type Role } from "@/lib/previewClient";

/**
 * The bar shown while an admin is previewing the app as another role. It makes
 * the lens impossible to forget (the whole app is narrowed to that role's
 * views) and carries the one way back — "Return to my view" — which clears the
 * cookie and reloads as the signed-in user. Rendered by the root layout only
 * when a preview is active.
 */
export function PreviewBanner({ role }: { role: Role }) {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-accent/40 bg-accent px-4 py-2 text-accent-fg">
      <p className="min-w-0 truncate text-sm font-semibold">
        Previewing as <span className="capitalize">{ROLE_LABEL[role]}</span>
      </p>
      <button
        type="button"
        onClick={() => stopPreview()}
        className="shrink-0 rounded-md bg-white/20 px-3 py-1 text-xs font-semibold text-accent-fg transition hover:bg-white/30"
      >
        Return to my view
      </button>
    </div>
  );
}
