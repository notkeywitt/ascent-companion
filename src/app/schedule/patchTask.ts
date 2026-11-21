/**
 * Edit one JobTread schedule task through the existing week route
 * (PATCH /api/home/week/task: name, description, start, end, done). That route
 * checks the task (not a phase, this org, an open job) and sits behind
 * `writesEnabled()`. `previewed` means writes are off and nothing was sent.
 */
export async function patchTask(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    start?: string;
    end?: string;
    done?: boolean;
  },
): Promise<{ error?: string; previewed?: boolean }> {
  const r = await fetch("/api/home/week/task", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, kind: "task", ...patch }),
  }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as {
    ok?: boolean;
    previewed?: boolean;
    error?: string;
  } | null;
  if (!r?.ok || !j?.ok) return { error: j?.error ?? "Could not save to JobTread." };
  return { previewed: !!j.previewed };
}
