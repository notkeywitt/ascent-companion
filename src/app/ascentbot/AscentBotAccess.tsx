"use client";

import { useEffect, useState } from "react";

import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  Input,
  Label,
  ListCard,
  Loading,
  MetaLine,
  SectionHeading,
  Select,
  Toggle,
} from "@/components/ui";
import type { BotArea } from "@/lib/botAccess";

interface Area {
  id: BotArea;
  label: string;
  desc: string;
}
interface Role {
  id: string;
  name: string;
  areas: BotArea[];
  people: number;
}
interface Person {
  email: string;
  name: string;
  roleId: string;
  active: boolean;
  lastAsked: string;
}
interface Snapshot {
  areas: Area[];
  roles: Role[];
  users: Person[];
}

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

/**
 * The AscentBot page's two lists: People (who may ask, on which role, on or
 * off) and Roles (which areas each role switches on). Every change saves at
 * once and the server's answer replaces the lists.
 */
export function AscentBotAccess() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(init?: RequestInit, query = "") {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/ascentbot${query}`, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
      setData(body as Snapshot);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const post = (body: unknown) =>
    call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  useEffect(() => {
    void call();
  }, []);

  if (!data) return err ? <Banner tone="error">{err}</Banner> : <Loading />;

  const areaLabel = (ids: BotArea[]) =>
    ids.length ? data.areas.filter((a) => ids.includes(a.id)).map((a) => a.label).join(", ") : "Job knowledge only";

  return (
    <div className="space-y-8">
      <Banner>
        Everyone on the list gets job knowledge: selections, scope, the schedule, notes, files,
        the calendar, to-dos, tools and contacts. A role adds the areas below. Someone not on the
        list, or switched off, gets no answer.
      </Banner>
      {err && <Banner tone="error">{err}</Banner>}

      <section>
        <SectionHeading trailing={<span className="text-xs text-neutral-500">{data.users.length}</span>}>
          People
        </SectionHeading>
        {data.users.length ? (
          <ListCard>
            {data.users.map((p) => (
              <PersonRow
                key={p.email}
                person={p}
                roles={data.roles}
                busy={busy}
                areaLabel={areaLabel}
                onSave={(next) => post({ kind: "user", ...next })}
                onRemove={() => call({ method: "DELETE" }, `?email=${encodeURIComponent(p.email)}`)}
              />
            ))}
          </ListCard>
        ) : (
          <EmptyState>Nobody can ask AscentBot yet.</EmptyState>
        )}
        <AddPerson roles={data.roles} busy={busy} onAdd={(p) => post({ kind: "user", ...p, active: true })} />
      </section>

      <section>
        <SectionHeading>Roles</SectionHeading>
        <div className="space-y-3">
          {data.roles.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              areas={data.areas}
              busy={busy}
              onSave={(next) => post({ kind: "role", id: r.id, ...next })}
              onDelete={() => call({ method: "DELETE" }, `?role=${encodeURIComponent(r.id)}`)}
            />
          ))}
          <RoleCard
            key="new"
            areas={data.areas}
            busy={busy}
            onSave={(next) => post({ kind: "role", ...next })}
          />
        </div>
      </section>
    </div>
  );
}

function PersonRow({
  person,
  roles,
  busy,
  areaLabel,
  onSave,
  onRemove,
}: {
  person: Person;
  roles: Role[];
  busy: boolean;
  areaLabel: (ids: BotArea[]) => string;
  onSave: (p: { email: string; name: string; roleId: string; active: boolean }) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(person.name);
  const [roleId, setRoleId] = useState(person.roleId);
  const role = roles.find((r) => r.id === person.roleId);

  return (
    <div className="px-3 py-2.5">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight">{person.name || person.email}</span>
          <MetaLine
            items={[
              person.name ? person.email : null,
              role?.name ?? "No role",
              person.lastAsked ? `last asked ${day(person.lastAsked)}` : "never asked",
            ]}
          />
        </span>
        {!person.active && <Chip tone="warning">Off</Chip>}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            {areaLabel(roles.find((r) => r.id === roleId)?.areas ?? [])}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              checked={person.active}
              disabled={busy}
              label={person.active ? "Can ask" : "Switched off"}
              onChange={(active) => onSave({ email: person.email, name, roleId, active })}
            />
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (confirm(`Remove ${person.email} from AscentBot?`)) void onRemove();
              }}
            >
              Remove
            </Button>
            <Button
              size="sm"
              disabled={busy || (name === person.name && roleId === person.roleId)}
              onClick={async () => {
                if (await onSave({ email: person.email, name, roleId, active: person.active })) setOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPerson({
  roles,
  busy,
  onAdd,
}: {
  roles: Role[];
  busy: boolean;
  onAdd: (p: { email: string; name: string; roleId: string }) => Promise<boolean>;
}) {
  // A new person starts on the role with the fewest areas: access is added on purpose.
  const narrowest = [...roles].sort((a, b) => a.areas.length - b.areas.length)[0]?.id ?? "";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(narrowest);
  const chosen = roles.some((r) => r.id === roleId) ? roleId : narrowest;

  return (
    <Card className="mt-3 space-y-3">
      <div className="text-sm font-semibold">Add a person</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Google email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@ascentbuildingco.com" />
        </div>
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label>Role</Label>
          <Select value={chosen} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          disabled={busy || !email.trim() || !chosen}
          onClick={async () => {
            if (await onAdd({ email, name, roleId: chosen })) {
              setEmail("");
              setName("");
            }
          }}
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

function RoleCard({
  role,
  areas,
  busy,
  onSave,
  onDelete,
}: {
  role?: Role;
  areas: Area[];
  busy: boolean;
  onSave: (r: { name: string; areas: BotArea[] }) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [on, setOn] = useState<BotArea[]>(role?.areas ?? []);
  const dirty = !role || name !== role.name || on.join() !== role.areas.join();

  return (
    <Card className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label>{role ? "Role" : "New role"}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Field lead" />
        </div>
        {role && <span className="pb-2 text-xs text-neutral-500">{role.people} {role.people === 1 ? "person" : "people"}</span>}
      </div>
      <div className="space-y-2">
        {areas.map((a) => (
          <div key={a.id}>
            <Toggle
              checked={on.includes(a.id)}
              label={a.label}
              onChange={(v) => setOn(v ? areas.map((x) => x.id).filter((id) => id === a.id || on.includes(id)) : on.filter((x) => x !== a.id))}
            />
            <p className="ml-11 text-xs text-neutral-500">{a.desc}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {role && onDelete && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || role.people > 0}
            title={role.people > 0 ? "Move everyone off this role first." : undefined}
            onClick={() => {
              if (confirm(`Delete the role "${role.name}"?`)) void onDelete();
            }}
          >
            Delete
          </Button>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          disabled={busy || !dirty || !name.trim()}
          onClick={async () => {
            if ((await onSave({ name, areas: on })) && !role) {
              setName("");
              setOn([]);
            }
          }}
        >
          {role ? "Save" : "Add role"}
        </Button>
      </div>
    </Card>
  );
}
