/**
 * Which inline fix a "Needs attention" row offers, and the JobTread id it acts
 * on. Owner approved two on 2026-11-16 (OVERHAUL_PLAN Phase 5, "Inline fixes"):
 *
 *   • approve-bill — invoice-review / pre-send rows of kind `qbo-never-approved`.
 *     The key is `kind|jobId|billId` (invoiceReview `findingKey`).
 *   • complete-todo — digest rows of check `jobtread-todos`. The key is
 *     `jobtread-todos::task:<id>` (digest `dismissalKey`).
 *
 * A structured `fixAction` wins when a source sets one: `action:id`, or a bare
 * id. Anything unexpected gives null, so the row shows no button.
 */
export type FixTarget = { action: "approve-bill"; docId: string } | { action: "complete-todo"; taskId: string };

type FixRow = { source: string; kind: string; key: string; fixAction?: string | null };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function actionFor(r: FixRow): FixTarget["action"] | null {
  if ((r.source === "invoice-review" || r.source === "pre-send") && r.kind === "qbo-never-approved") return "approve-bill";
  if (r.source === "digest" && r.kind === "jobtread-todos") return "complete-todo";
  return null;
}

function idFromKey(action: FixTarget["action"], key: string): string | null {
  if (action === "approve-bill") {
    const parts = key.split("|");
    return parts.length === 3 && parts[0] === "qbo-never-approved" ? parts[2] : null;
  }
  return /^jobtread-todos::task:(.+)$/.exec(key)?.[1] ?? null;
}

export function fixTarget(r: FixRow): FixTarget | null {
  const action = actionFor(r);
  if (!action) return null;
  const fa = (r.fixAction ?? "").trim();
  let id: string | null;
  // `action:id` must name this row's action; a bare id is taken as is. A to-do
  // id may keep the digest's `task:` prefix.
  if (fa.startsWith(`${action}:`)) id = fa.slice(action.length + 1);
  else if (fa) id = fa;
  else id = idFromKey(action, r.key);
  if (action === "complete-todo" && id?.startsWith("task:")) id = id.slice(5);
  if (!id || !ID.test(id)) return null;
  return action === "approve-bill" ? { action, docId: id } : { action, taskId: id };
}
