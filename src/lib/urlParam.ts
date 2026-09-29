/**
 * The month (and job) a person picked, kept in the address bar so the
 * workspace tab strip carries it to the next tab (src/components/WorkspaceTabs).
 *
 * `setUrlParam` rewrites the query in place: no navigation, no new history
 * entry. Next.js syncs `useSearchParams` with `history.replaceState`, so the
 * strip's links update at once. Client only.
 */

/** A "YYYY-MM" month, or "" for anything else. */
export function asYm(v: string | null | undefined): string {
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : "";
}

/** The URL's `?ym`, when it is a real month. Call from an effect or a handler. */
export function urlYm(): string {
  return typeof window === "undefined" ? "" : asYm(new URLSearchParams(window.location.search).get("ym"));
}

/** "?jobId=…&ym=…" — the job and month a workspace link carries, or "". */
export function carryJobAndMonth(search: { get(key: string): string | null }): string {
  const carry = new URLSearchParams();
  for (const key of ["jobId", "ym"]) {
    const v = (search.get(key) ?? "").trim();
    if (v) carry.set(key, v);
  }
  return carry.size ? `?${carry}` : "";
}

export function setUrlParam(key: string, value: string): void {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(key, value);
  else params.delete(key);
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
