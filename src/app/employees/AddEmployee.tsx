"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, FilterChip, Label, Select, inputCls } from "@/components/ui";
import { ROLES, type Role } from "@/lib/views";

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  hireDate: string;
  status: string;
  phone: string;
  email: string;
  address: string;
  birthday: string;
  dl: string;
  role: string;
  leavePayType: string;
  jtUserId: string;
  jtUserName: string;
}

interface JtMember {
  id: string;
  name: string;
  email: string;
}

type Draft = Pick<
  Employee,
  "firstName" | "lastName" | "position" | "hireDate" | "status" | "phone" | "address" | "birthday" | "dl"
>;

const FIELDS: { key: keyof Draft; label: string; wide?: boolean }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "position", label: "Position" },
  { key: "hireDate", label: "Hire date" },
  { key: "phone", label: "Phone" },
  { key: "birthday", label: "Birthday" },
  { key: "dl", label: "Driver's license" },
  { key: "address", label: "Address", wide: true },
];

// "existing" = the email of someone who can already sign in; "new" = add a sign-in
// for this email too (admin only, /api/team); "none" = roster row only.
type Access = "existing" | "new" | "none";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The Add employee form. Writes one row to the Employee tab (POST
 * /api/employees), then — when asked — adds the email as an app user through
 * the same admin-only /api/team route /admin uses. The roster row is what links
 * a login to a JobTread user; the app user is what lets that login in at all.
 */
export function AddEmployee({
  employees,
  statuses,
  onAdded,
  onClose,
}: {
  employees: Employee[];
  statuses: string[];
  onAdded: (e: Employee) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    firstName: "",
    lastName: "",
    position: "",
    hireDate: "",
    status: statuses.find((s) => norm(s) === "active") ?? "Active",
    phone: "",
    address: "",
    birthday: "",
    dl: "",
  });
  const [email, setEmail] = useState("");
  const [jtUserId, setJtUserId] = useState("");
  const [access, setAccess] = useState<Access>("none");
  const [newRole, setNewRole] = useState<Role>("field");

  const [members, setMembers] = useState<JtMember[]>([]);
  const [jtErr, setJtErr] = useState("");
  // App users by email → role. null = not an admin (or /api/team unreachable).
  const [appUsers, setAppUsers] = useState<Map<string, string> | null>(null);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/employees/jt-members")
      .then((r) => r.json())
      .then((j) => (j.error ? setJtErr(j.error) : setMembers(j.members ?? [])))
      .catch((e) => setJtErr(e instanceof Error ? e.message : "Could not load JobTread users."));
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        const m = new Map<string, string>();
        (j.envAdmins ?? []).forEach((e: string) => m.set(norm(e), "admin"));
        (j.members ?? []).forEach((u: { email: string; role: string }) => m.set(norm(u.email), u.role));
        setAppUsers(m);
      })
      .catch(() => {});
  }, []);

  const rosterEmails = useMemo(
    () => new Set(employees.map((e) => norm(e.email)).filter(Boolean)),
    [employees],
  );
  const linkedJt = useMemo(() => new Set(employees.map((e) => e.jtUserId).filter(Boolean)), [employees]);

  // JobTread staff with no roster row yet: not linked, and their email not on the roster.
  const suggestions = useMemo(
    () => members.filter((m) => !linkedJt.has(m.id) && !(m.email && rosterEmails.has(m.email))),
    [members, linkedJt, rosterEmails],
  );
  // App users with no roster row yet — the "existing user" choices.
  const freeAppUsers = useMemo(
    () => (appUsers ? [...appUsers.keys()].filter((e) => !rosterEmails.has(e)).sort() : []),
    [appUsers, rosterEmails],
  );

  // Setting the email also links the JobTread member who signs in with it, when
  // nothing is linked yet — the same address, the same person.
  function pickEmail(next: string) {
    setEmail(next);
    if (!jtUserId) {
      const m = members.find((x) => x.email && x.email === norm(next) && !linkedJt.has(x.id));
      if (m) setJtUserId(m.id);
    }
  }

  function applySuggestion(m: JtMember) {
    const [first, ...rest] = m.name.trim().split(/\s+/);
    setDraft((d) => ({ ...d, firstName: first ?? "", lastName: rest.join(" ") }));
    setJtUserId(m.id);
    setEmail(m.email);
    if (appUsers && m.email) setAccess(appUsers.has(m.email) ? "existing" : "new");
  }

  const emailIsUser = !!appUsers?.has(norm(email));

  async function save() {
    if (done) return onClose();
    if (!draft.firstName.trim()) return setErr("First name is required.");
    if (access !== "none" && !norm(email).includes("@")) return setErr("Enter the email they sign in with.");
    setSaving(true);
    setErr("");
    let added: Employee | null = null;
    try {
      const jt = members.find((m) => m.id === jtUserId);
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: { ...draft, email: norm(email), jtUserId: jt?.id ?? "", jtUserName: jt?.name ?? "" },
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not add the employee.");
      added = json.employee as Employee;
      onAdded(added);

      if (access === "new" && !emailIsUser) {
        const t = await fetch("/api/team", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: norm(email), role: newRole }),
        });
        if (!t.ok) {
          const tj = await t.json().catch(() => ({}));
          throw new Error(tj.error || `HTTP ${t.status}`);
        }
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      if (added) {
        setErr(`${added.firstName} is on the roster, but the app user was not created (${msg}). Add it on /admin.`);
        setDone(true);
      } else setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-ink-overlay sm:rounded-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-bold">New employee</h2>

        {suggestions.length > 0 && (
          <div className="mb-4">
            <Label>In JobTread, not on the roster</Label>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((m) => (
                <FilterChip key={m.id} on={jtUserId === m.id} onClick={() => applySuggestion(m)} title={m.email}>
                  {m.name}
                </FilterChip>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
              <Label>{f.label}</Label>
              <input value={draft[f.key]} onChange={(ev) => set(f.key, ev.target.value)} className={inputCls} />
            </div>
          ))}
          <div>
            <Label>Status</Label>
            <Select value={draft.status} onChange={(ev) => set("status", ev.target.value)}>
              {!statuses.includes(draft.status) && <option value={draft.status}>{draft.status}</option>}
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>JobTread user</Label>
            {jtErr ? (
              <p className="py-2 text-sm text-neutral-500">Unavailable ({jtErr}).</p>
            ) : (
              <Select value={jtUserId} onChange={(ev) => setJtUserId(ev.target.value)}>
                <option value="">— Not linked —</option>
                {members
                  .filter((m) => m.id === jtUserId || !linkedJt.has(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            )}
          </div>
        </div>

        {/* App sign-in */}
        <div className="mt-4 rounded-lg border border-line p-3">
          <Label>App sign-in</Label>
          {appUsers && (
            <div className="mb-3 flex flex-wrap gap-2">
              <FilterChip on={access === "existing"} onClick={() => setAccess("existing")}>
                Existing user
              </FilterChip>
              <FilterChip on={access === "new"} onClick={() => setAccess("new")}>
                New user
              </FilterChip>
              <FilterChip on={access === "none"} onClick={() => setAccess("none")}>
                No sign-in
              </FilterChip>
            </div>
          )}

          {access === "existing" ? (
            <Select value={norm(email)} onChange={(ev) => pickEmail(ev.target.value)}>
              <option value="">— Pick an app user —</option>
              {norm(email) && !freeAppUsers.includes(norm(email)) && (
                <option value={norm(email)}>{norm(email)}</option>
              )}
              {freeAppUsers.map((e) => (
                <option key={e} value={e}>
                  {e} · {appUsers?.get(e)}
                </option>
              ))}
            </Select>
          ) : (
            <input
              type="email"
              value={email}
              onChange={(ev) => pickEmail(ev.target.value)}
              placeholder="Email they sign in with"
              className={inputCls}
            />
          )}

          {access === "new" && (
            <div className="mt-3">
              <Label>App role</Label>
              <Select value={newRole} onChange={(ev) => setNewRole(ev.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <p className="mt-2 text-[12px] text-neutral-500">
            {!appUsers
              ? "Only an admin can add app users. An admin grants sign-in on /admin."
              : emailIsUser
                ? `✓ Already an app user (${appUsers.get(norm(email))}).`
                : access === "new"
                  ? "Saving also lets this email sign in."
                  : access === "existing"
                    ? "App users who have no roster row yet."
                    : "The roster row only. They can't sign in until an admin adds them."}
          </p>
        </div>

        {err && (
          <Banner tone={done ? "warning" : "error"} className="mt-3">
            {err}
          </Banner>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={save} disabled={saving}>
            {saving ? "Adding…" : done ? "Close" : "Add employee"}
          </Button>
        </div>
      </div>
    </div>
  );
}
