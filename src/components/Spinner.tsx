/**
 * The app's one spinner, in its own module.
 *
 * It lives here rather than in components/ui so the dependency between the
 * design system and the link-pending overlay runs ONE way: ui.tsx's <ListRow>
 * renders <LinkPendingOverlay>, and LinkPending needs a spinner. With Spinner
 * defined in ui.tsx those two modules would import each other, and a cycle that
 * happens to work under one bundler is a trap for the next person. `ui.tsx`
 * re-exports this, so `import { Spinner } from "@/components/ui"` still works
 * everywhere it already appears.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-accent dark:border-neutral-600 dark:border-t-accent ${className}`}
    />
  );
}
