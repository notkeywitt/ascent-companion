/**
 * Client-safe helper for calling the guarded Pave gateway from the browser.
 *
 * Contains NO grant key and no server imports — safe in client components. Pass
 * a Pave query object (shapes: JT_API_REFERENCE.md) WITHOUT a root `$` (the
 * server injects the grantKey). Returns the Pave result tree, or throws with the
 * gateway's error message (e.g. a role/write-gate refusal).
 *
 *   const r = await gatewayQuery<{ job: { name: string } }>({
 *     job: { $: { id: jobId }, name: {} },
 *   });
 *   r.job.name
 */
export async function gatewayQuery<T = unknown>(query: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/pave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  let json: { data?: T; error?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `Gateway error (HTTP ${res.status})`);
  }
  return json.data as T;
}
