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
import { ROLE_LABEL, PREVIEW_COOKIE, parsePreviewRole } from "@/lib/preview";
import { startPreview, stopPreview } from "@/lib/previewClient";
import { ActivityPanel } from "./ActivityPanel";
import { NoticesPanel } from "./NoticesPanel";
import { DigestSettingsPanel } from "./DigestSettingsPanel";

interface Member {
  email: string;
  addedBy: string;
  createdAt: string;
  role: Role;
  viewsAllow: string[];
  viewsDeny: string[];
}

type RoleOverride = { viewsAllow: string[]; viewsDeny: string[] };
type RoleOverrides = Partial<Record<Role, RoleOverride>>;
const NO_OVERRIDE: RoleOverride = { viewsAllow: [], viewsDeny: [] };
// Roles a role-default edit can touch. Admin always gets every view — editing
// it here isn't offered, so a bad edit can't lock every admin out of /admin.
const EDITABLE_ROLES: Role[] = ["office", "lead", "field"];

// Views grouped for the override editor, in a stable display order.
const GROUP_ORDER = ["Financials", "Field", "Assistant", "Office", "System"] as const;
const GROUPED = GROUP_ORDER.map((g) => ({
  group: g,
  views: VIEWS.filter((v) => v.group === g),
})).filter((g) => g.views.length > 0);

export default function AdminPage() {
  const [tab, setTab] = useState<"access" | "activity" | "notices" | "digest">("access");
  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Admin"
        description="Who can sign in, what each person can see, how the panel is being used, notices pushed to the team, and the Daily Digest's settings."
        className="!mb-4"
      />
      <div className="mb-5 inline-flex rounded-lg border border-line p-0.5 ">
        <TabButton active={tab === "access"} onClick={() => setTab("access")}>
          Access
        </TabButton>
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
          Activity
        </TabButton>
        <TabButton active={tab === "notices"} onClick={() => setTab("notices")}>
          Notices
        </TabButton>
        <TabButton active={tab === "digest"} onClick={() => setTab("digest")}>
          Digest
        </TabButton>
      </div>
      {tab === "access" ? (
        <AccessPanel />
      ) : tab === "activity" ? (
        <ActivityPanel />
      ) : tab === "notices" ? (
        <NoticesPanel />
      ) : (
        <DigestSettingsPanel />
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-sm font-medium transition ${
        active
          ? "bg-accent text-white shadow-sm"
          : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function AccessPanel() {
  const [envAdmins, setEnvAdmins] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [roleOverrides, setRoleOverrides] = useState<RoleOverrides>({});
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
      setRoleOverrides(j.roleOverrides ?? {});
      setMe(j.me ?? null);
      setErr("");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Whether the admin is currently viewing the app as another role, read from
  // the preview cookie so the "Return to my view" link only shows when it's
  // actually doing something. (Set/cleared by startPreview/stopPreview, which
  // reload the page, so a one-time read on mount is enough.)
  const previewingAs = useMemo(() => {
    if (typeof document === "undefined") return null;
    const raw = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${PREVIEW_COOKIE}=`))
      ?.split("=")[1];
    return parsePreviewRole(raw);
  }, []);

  async function patchRole(r: Role, fields: RoleOverride) {
    const res = await fetch("/api/team/roles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: r, ...fields }),
    });
    if (res.ok) setRoleOverrides((await res.json()).roleOverrides ?? {});
  }

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
    <div>
      {me && <p className="mb-3 text-xs text-neutral-500">You&rsquo;re signed in as {me}.</p>}

      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      <form onSubmit={add} className="mb-2 flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@gmail.com"
          className="min-w-0 flex-1"
        />
        <div className="flex gap-2">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="min-w-0 flex-1 sm:w-28 sm:flex-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <Button type="submit" className="shrink-0">
            Add
          </Button>
        </div>
      </form>
      <p className="mb-5 text-xs text-neutral-500">
        New people default to <strong>Field</strong>. Role or view changes take effect the next
        time that person signs in.
      </p>

      {loading && <Loading label="Loading team…" />}

      <div className="mb-1 flex items-center justify-between gap-2">
        <SectionLabel className="mb-0">Role Defaults</SectionLabel>
        {previewingAs && (
          <button
            onClick={() => stopPreview()}
            className="shrink-0 text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
          >
            Return to my view
          </button>
        )}
      </div>
      <p className="mb-2 text-xs text-neutral-500">
        What everyone in a role sees by default. A person&rsquo;s own overrides (below)
        still apply on top of this. Admin always has full access.{" "}
        <strong>Preview</strong> opens the app&rsquo;s home page as that role sees it;
        use <strong>Return to my view</strong> (here or in the banner) to come back.
      </p>
      <ul className="mb-5 space-y-2">
        {EDITABLE_ROLES.map((r) => (
          <RoleRow key={r} role={r} override={roleOverrides[r] ?? NO_OVERRIDE} patchRole={patchRole} />
        ))}
      </ul>

      {envAdmins.length > 0 && (
        <div className="mb-4">
          <SectionLabel className="mb-1">Founders (set in hosting config)</SectionLabel>
          <ul className="space-y-1">
            {envAdmins.map((e) => (
              <li
                key={e}
                className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm "
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
          <MemberRow
            key={m.email}
            member={m}
            roleOverride={roleOverrides[m.role] ?? NO_OVERRIDE}
            patch={patch}
            remove={remove}
          />
        ))}
        {!loading && members.length === 0 && (
          <li className="rounded-lg border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
            No added members yet — just the founders above.
          </li>
        )}
      </ul>
    </div>
  );
}

function MemberRow({
  member,
  roleOverride,
  patch,
  remove,
}: {
  member: Member;
  roleOverride: RoleOverride;
  patch: (email: string, fields: Partial<Pick<Member, "role" | "viewsAllow" | "viewsDeny">>) => void;
  remove: (email: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // The role's CURRENT default (hardcoded, adjusted by any Role Defaults edit
  // above) — a per-user override is a delta from this, same as what auth.ts
  // bakes into the JWT at sign-in.
  const base = useMemo(
    () => resolveAllowedViews(member.role, roleOverride.viewsAllow, roleOverride.viewsDeny),
    [member.role, roleOverride],
  );
  const effective = useMemo(
    () => resolveAllowedViews(member.role, member.viewsAllow, member.viewsDeny, base),
    [member.role, member.viewsAllow, member.viewsDeny, base],
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
    <li className="rounded-lg border border-line bg-white px-3 py-2 text-sm dark:bg-ink-raised">
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
        <div className="mt-3 border-t border-line-soft pt-3 dark:border-white/10">
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

function RoleRow({
  role,
  override,
  patchRole,
}: {
  role: Role;
  override: RoleOverride;
  patchRole: (role: Role, fields: RoleOverride) => void;
}) {
  const [open, setOpen] = useState(false);

  // The hardcoded factory default (lib/views.ts) — what an edit here is a delta
  // from, and what "Reset to default" reverts to.
  const factoryDefault = useMemo(() => new Set(ROLE_VIEWS[role]), [role]);
  const effective = useMemo(
    () => resolveAllowedViews(role, override.viewsAllow, override.viewsDeny),
    [role, override],
  );
  const overrideCount = override.viewsAllow.length + override.viewsDeny.length;

  function toggle(viewId: string, on: boolean) {
    const eff = new Set(effective);
    if (on) eff.add(viewId);
    else eff.delete(viewId);
    const viewsAllow = [...eff].filter((id) => !factoryDefault.has(id));
    const viewsDeny = [...factoryDefault].filter((id) => !eff.has(id));
    patchRole(role, { viewsAllow, viewsDeny });
  }

  return (
    <li className="rounded-lg border border-line bg-white px-3 py-2 text-sm dark:bg-ink-raised">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{ROLE_LABEL[role]}</span>
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => startPreview(role)}
            className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
          >
            Preview
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
          >
            Views{overrideCount > 0 ? ` (${overrideCount})` : ""}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 border-t border-line-soft pt-3 dark:border-white/10">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              Toggle what every <strong>{ROLE_LABEL[role]}</strong> gets by default.
            </span>
            {overrideCount > 0 && (
              <button
                onClick={() => patchRole(role, { viewsAllow: [], viewsDeny: [] })}
                className="shrink-0 text-xs font-semibold text-neutral-500 hover:text-accent"
              >
                Reset to default
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
                    const overridden = on !== factoryDefault.has(v.id);
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
