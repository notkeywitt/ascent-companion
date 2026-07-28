"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Input,
  Loading,
  PageHeader,
  SectionLabel,
  Select,
  Toggle,
} from "@/components/ui";
import {
  ROLE_VIEWS,
  ROLES,
  VIEWS,
  resolveAllowedViews,
  type Role,
} from "@/lib/views";

interface Member {
  email: string;
  addedBy: string;
  createdAt: string;
  role: Role;
  viewsAllow: string[];
  viewsDeny: string[];
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  office: "Office",
  lead: "Lead",
  field: "Field",
};

// Views grouped for the override editor, in a stable display order.
const GROUP_ORDER = ["Financials", "Field", "Assistant", "Office", "System"] as const;
const GROUPED = GROUP_ORDER.map((g) => ({
  group: g,
  views: VIEWS.filter((v) => v.group === g),
})).filter((g) => g.views.length > 0);

export default function AdminPage() {
  const [envAdmins, setEnvAdmins] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("field");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/team");
      if (!res.ok) {
        setErr(res.status === 403 ? "Only admins can manage team access." : "Failed to load team.");
        return;
      }
      const j = await res.json();
      setEnvAdmins(j.envAdmins ?? []);
      setMembers(j.members ?? []);
      setMe(j.me ?? null);
      setErr("");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return;
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      setEmail("");
      setRole("field");
      setMembers((await res.json()).members ?? []);
    }
  }

  async function patch(memberEmail: string, fields: Partial<Pick<Member, "role" | "viewsAllow" | "viewsDeny">>) {
    const res = await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: memberEmail, ...fields }),
    });
    if (res.ok) setMembers((await res.json()).members ?? []);
  }

  async function remove(em: string) {
    const res = await fetch(`/api/team?email=${encodeURIComponent(em)}`, { method: "DELETE" });
    if (res.ok) setMembers((await res.json()).members ?? []);
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Team Access"
        description={`Who can sign in, and what each person can see.${me ? ` You're ${me}.` : ""}`}
        className="!mb-4"
      />

      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      <form onSubmit={add} className="mb-2 flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@gmail.com"
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-28 shrink-0">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
        <Button type="submit" className="shrink-0">
          Add
        </Button>
      </form>
      <p className="mb-5 text-xs text-neutral-500">
        New people default to <strong>Field</strong>. Role or view changes take effect the next
        time that person signs in.
      </p>

      {loading && <Loading label="Loading team…" />}

      {envAdmins.length > 0 && (
        <div className="mb-4">
          <SectionLabel className="mb-1">Founders (set in hosting config)</SectionLabel>
          <ul className="space-y-1">
            {envAdmins.map((e) => (
              <li
                key={e}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700/60"
              >
                <span>{e}</span>
                <span className="text-xs text-neutral-400">Admin · always allowed</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SectionLabel className="mb-1">Members</SectionLabel>
      <ul className="space-y-2">
        {members.map((m) => (
          <MemberRow key={m.email} member={m} patch={patch} remove={remove} />
        ))}
        {!loading && members.length === 0 && (
          <li className="rounded-lg border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
            No added members yet — just the founders above.
          </li>
        )}
      </ul>
    </main>
  );
}

function MemberRow({
  member,
  patch,
  remove,
}: {
  member: Member;
  patch: (email: string, fields: Partial<Pick<Member, "role" | "viewsAllow" | "viewsDeny">>) => void;
  remove: (email: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const base = useMemo(() => new Set(ROLE_VIEWS[member.role]), [member.role]);
  const effective = useMemo(
    () => resolveAllowedViews(member.role, member.viewsAllow, member.viewsDeny),
    [member.role, member.viewsAllow, member.viewsDeny],
  );
  const overrideCount = member.viewsAllow.length + member.viewsDeny.length;

  function toggle(viewId: string, on: boolean) {
    const eff = new Set(effective);
    if (on) eff.add(viewId);
    else eff.delete(viewId);
    // Store overrides as deltas from the role's base set.
    const viewsAllow = [...eff].filter((id) => !base.has(id));
    const viewsDeny = [...base].filter((id) => !eff.has(id));
    patch(member.email, { viewsAllow, viewsDeny });
  }

  return (
    <li className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700/60 dark:bg-ink-raised">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{member.email}</span>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={member.role}
            onChange={(e) => patch(member.email, { role: e.target.value as Role })}
            className="w-24 !py-1 text-xs"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
          >
            Views{overrideCount > 0 ? ` (${overrideCount})` : ""}
          </button>
          <button
            onClick={() => remove(member.email)}
            className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
          >
            Remove
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-white/10">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              Toggle what {member.email.split("@")[0]} can open. Defaults come from the{" "}
              <strong>{ROLE_LABEL[member.role]}</strong> role.
            </span>
            {overrideCount > 0 && (
              <button
                onClick={() => patch(member.email, { viewsAllow: [], viewsDeny: [] })}
                className="shrink-0 text-xs font-semibold text-neutral-500 hover:text-accent"
              >
                Reset to role
              </button>
            )}
          </div>
          <div className="space-y-3">
            {GROUPED.map((g) => (
              <div key={g.group}>
                <SectionLabel className="mb-1">{g.group}</SectionLabel>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {g.views.map((v) => {
                    const on = effective.has(v.id);
                    const overridden = on !== base.has(v.id);
                    return (
                      <div key={v.id} className="flex items-center gap-2">
                        <Toggle checked={on} onChange={(next) => toggle(v.id, next)} label={v.label} />
                        {overridden && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                            override
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
