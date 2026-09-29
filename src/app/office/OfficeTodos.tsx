"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  FilterChip,
  Input,
  Label,
  ListCard,
  MetaLine,
  Textarea,
} from "@/components/ui";
import { jtToDoUrl } from "@/lib/jtLinks";
import { dayLabel } from "@/lib/timeEntryDates";

/**
 * The Office job's open to-dos, editable in place: tick one done, tap one to
 * edit or delete it, or add a new one. Every write goes to /api/office/todos,
 * then `router.refresh()` re-reads the list on the server — this component
 * never keeps its own copy of what JobTread holds.
 */

/** One open to-do, as the server page hands it over. */
export interface OfficeTodo {
  id: string;
  name: string;
  description: string;
  /** Org-local "YYYY-MM-DD", or "". */
  due: string;
  overdue: boolean;
  assignees: string[];
  /** JobTread USER ids — mapped to membership ids through /api/jt-users. */
  assigneeIds: string[];
}

/** An employee from /api/jt-users. */
interface JtUser {
  id: string;
  name: string;
  isInternal: boolean;
  membershipId?: string;
}

type Send = (
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>,
) => Promise<boolean>;

export function OfficeTodos({
  todos,
  onChanged,
}: {
  todos: OfficeTodo[];
  /** Called after a write. The Office page re-reads through router.refresh();
   *  Today fetched this list itself, so it passes a reload. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<JtUser[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // a to-do id, or "new"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  // The last to-do ticked done, so a mis-tap can be taken back from here.
  const [lastDone, setLastDone] = useState<OfficeTodo | null>(null);

  useEffect(() => {
    fetch("/api/jt-users")
      .then((r) => r.json())
      .then((u) =>
        setUsers(((u?.users ?? []) as JtUser[]).filter((x) => x.isInternal && x.membershipId)),
      )
      .catch(() => setUsers([]));
  }, []);

  /** One write. True when JobTread took it (or writes are off and it was previewed). */
  const send: Send = async (method, body) => {
    setBusy(true);
    setErr("");
    setNotice("");
    setLastDone(null);
    try {
      const url =
        method === "DELETE"
          ? `/api/office/todos?id=${encodeURIComponent(String(body.id))}`
          : "/api/office/todos";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json.error || "JobTread did not take that change.");
        return false;
      }
      if (json.previewed) setNotice("Writes are off, so nothing was sent to JobTread.");
      router.refresh();
      onChanged?.();
      return true;
    } catch {
      setErr("JobTread did not take that change.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {err && <Banner tone="error">{err}</Banner>}
      {notice && <Banner>{notice}</Banner>}
      {lastDone && (
        <p className="flex items-center gap-2 text-[12.5px] text-neutral-500 dark:text-neutral-400">
          ✓ Marked &ldquo;{lastDone.name}&rdquo; done.
          <button
            type="button"
            disabled={busy}
            onClick={() => send("PATCH", { id: lastDone.id, done: false })}
            className="font-semibold text-accent dark:text-accent-soft"
          >
            Undo
          </button>
        </p>
      )}

      {todos.length === 0 && editing !== "new" && (
        <EmptyState>No open to-dos on the Office job.</EmptyState>
      )}

      {todos.length > 0 && (
        <ListCard>
          {todos.map((t) =>
            editing === t.id ? (
              <div key={t.id} className="border-b border-line-soft p-3 last:border-b-0">
                <TodoForm
                  todo={t}
                  users={users}
                  busy={busy}
                  send={send}
                  onDone={() => setEditing(null)}
                />
              </div>
            ) : (
              <TodoRow
                key={t.id}
                todo={t}
                busy={busy}
                onTick={async () => {
                  if (await send("PATCH", { id: t.id, done: true })) setLastDone(t);
                }}
                onEdit={() => setEditing(t.id)}
              />
            ),
          )}
        </ListCard>
      )}

      {editing === "new" ? (
        <Card>
          <TodoForm users={users} busy={busy} send={send} onDone={() => setEditing(null)} />
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="w-full rounded-xl border border-dashed border-line px-3 py-2.5 text-left text-[12.5px] font-semibold text-neutral-500 transition hover:border-accent hover:text-accent dark:text-neutral-400"
        >
          + New to-do
        </button>
      )}
    </div>
  );
}

function TodoRow({
  todo: t,
  busy,
  onTick,
  onEdit,
}: {
  todo: OfficeTodo;
  busy: boolean;
  onTick: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex min-h-[56px] items-center gap-1 border-b border-line-soft pr-3 last:border-b-0">
      <button
        type="button"
        onClick={onTick}
        disabled={busy}
        aria-label={`Mark "${t.name}" done`}
        title="Mark done"
        className="group flex h-11 w-11 shrink-0 items-center justify-center text-neutral-400 transition hover:text-accent disabled:opacity-40"
      >
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-current text-[11px] font-bold"
        >
          <span className="opacity-0 transition group-hover:opacity-100">✓</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 py-2.5 text-left transition hover:text-accent"
      >
        <span className="block break-words text-sm font-semibold tracking-tight">{t.name}</span>
        <MetaLine
          className="mt-0.5"
          items={[t.due && `Due ${dayLabel(t.due)}`, t.assignees.join(", ") || "Unassigned"]}
        />
      </button>
      {t.overdue && <Chip tone="danger">Overdue</Chip>}
    </div>
  );
}

/** Create (no `todo`) or edit one to-do. Sends only the fields that changed. */
function TodoForm({
  todo,
  users,
  busy,
  send,
  onDone,
}: {
  todo?: OfficeTodo;
  users: JtUser[] | null;
  busy: boolean;
  send: Send;
  onDone: () => void;
}) {
  const [name, setName] = useState(todo?.name ?? "");
  const [description, setDescription] = useState(todo?.description ?? "");
  const [due, setDue] = useState(todo?.due ?? "");
  // Assignees are picked by user id and sent as membership ids. Untouched, they
  // are not sent at all — so a user list that failed to load never wipes them.
  const [who, setWho] = useState<Set<string>>(new Set(todo?.assigneeIds ?? []));
  const [whoTouched, setWhoTouched] = useState(false);

  const toggle = (userId: string) => {
    setWhoTouched(true);
    setWho((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };
  const membershipIds = () =>
    (users ?? []).filter((u) => who.has(u.id)).map((u) => u.membershipId as string);

  async function save() {
    if (!name.trim()) return;
    let ok: boolean;
    if (!todo) {
      ok = await send("POST", {
        name: name.trim(),
        description: description.trim() || undefined,
        dueDate: due || undefined,
        membershipIds: membershipIds(),
      });
    } else {
      const patch: Record<string, unknown> = { id: todo.id };
      if (name.trim() !== todo.name) patch.name = name.trim();
      if (description.trim() !== todo.description.trim())
        patch.description = description.trim() || null;
      if (due !== todo.due) patch.dueDate = due || null;
      if (whoTouched) patch.membershipIds = membershipIds();
      if (Object.keys(patch).length === 1) return onDone();
      ok = await send("PATCH", patch);
    }
    if (ok) onDone();
  }

  async function remove() {
    if (!todo || !window.confirm(`Delete "${todo.name}" from JobTread? This cannot be undone.`))
      return;
    if (await send("DELETE", { id: todo.id })) onDone();
  }

  const uid = todo?.id ?? "new";
  return (
    <div className="space-y-2.5">
      <div>
        <Label htmlFor={`todo-name-${uid}`}>What needs doing</Label>
        <Input
          id={`todo-name-${uid}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Renew the reseller permit"
          disabled={busy}
          autoFocus
        />
      </div>

      <div>
        <Label>Assigned to</Label>
        {users === null ? (
          <p className="text-[12.5px] text-neutral-500">Loading people…</p>
        ) : users.length === 0 ? (
          <p className="text-[12.5px] text-neutral-500">Couldn&rsquo;t load the employee list.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {users.map((u) => (
              <FilterChip key={u.id} on={who.has(u.id)} onClick={() => toggle(u.id)}>
                {u.name}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor={`todo-due-${uid}`}>Due</Label>
        <Input
          id={`todo-due-${uid}`}
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          disabled={busy}
        />
      </div>

      <div>
        <Label htmlFor={`todo-detail-${uid}`}>Details</Label>
        <Textarea
          id={`todo-detail-${uid}`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || !name.trim()}>
          {busy ? "Saving…" : todo ? "Save" : "Add to JobTread"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        {todo && (
          <>
            <a
              href={jtToDoUrl(todo.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-accent dark:text-accent-soft"
            >
              JobTread ↗
            </a>
            <Button size="sm" variant="danger" onClick={remove} disabled={busy} className="ml-auto">
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
