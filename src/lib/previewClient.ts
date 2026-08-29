/**
 * Browser-side helpers for the role preview (see src/lib/preview.ts). The
 * cookie is intentionally NOT httpOnly so the launcher and admin page can set
 * and clear it directly, then do a full navigation so the server layout re-reads
 * it and re-renders the nav as the previewed role.
 */
import { PREVIEW_COOKIE, type Role } from "@/lib/preview";
export { type Role } from "@/lib/preview";

/** Start previewing the app as `role`, then land on the role's home page. */
export function startPreview(role: Role): void {
  // 1-day life so a forgotten preview lapses on its own; path=/ so every page
  // sees it. Lax is enough — this is a same-site navigation, never a form post.
  document.cookie = `${PREVIEW_COOKIE}=${role}; path=/; max-age=86400; samesite=lax`;
  // Full load (not router.push) so the SERVER layout re-reads the cookie.
  window.location.assign("/");
}

/** Stop previewing and return to the signed-in user's own view. */
export function stopPreview(): void {
  document.cookie = `${PREVIEW_COOKIE}=; path=/; max-age=0; samesite=lax`;
  window.location.assign("/");
}
