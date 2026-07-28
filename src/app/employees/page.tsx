"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Label,
  Loading,
  PageHeader,
  Textarea,
  inputCls,
} from "@/components/ui";

interface Employee {
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

interface JtUser {
  id: string;
  name: string;
  isInternal: boolean;
  types?: { name: string; hourlyRate?: number }[]; // this member's own pay types
}

type EditableKey = keyof Omit<Employee, "id" | "jtUserId" | "jtUserName">;

const FIELDS: { key: EditableKey; label: string; wide?: boolean }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "position", label: "Position" },
  { key: "hireDate", label: "Hire date" },
  { key: "status", label: "Status" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "birthday", label: "Birthday" },
  { key: "dl", label: "Driver's license" },
  { key: "role", label: "Role" },
  { key: "leavePayType", label: "Leave pay type" },
  { key: "address", label: "Address", wide: true },
];

type SortKey = "name" | "position" | "status";

const statusClass = (s: string) => {
  const k = s.toLowerCase();
  if (k === "active") return "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50";
  if (k === "retired") return "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800";
  return "text-accent bg-accent/10";
};

const norm = (s: string) => s.trim().toLowerCase();

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [jtUsers, setJtUsers] = useState<JtUser[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]); // fallback pay-type names
  const [jtErr, setJtErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [linkingId, setLinkingId] = useState(""); // employee id being one-click linked

  // Email composer — send one message from office@ to a chosen set of employees.
  const [composing, setComposing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [sendResult, setSendResult] = useState<{
    sent: number;
    skipped: { id: string; name: string; reason: string }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/employees?full=1");
        const json = await res.json();
        if (!res.ok || json.ok === false) {
          setLoadErr(json.error || "Could not load employees.");
          return;
        }
        setEmployees(json.employees ?? []);
        setStatuses(json.statuses ?? []);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "Could not load employees.");
      } finally {
        setLoading(false);
      }
    })();
    // JobTread users load independently — the roster still works without them.
    (async () => {
      try {
        const res = await fetch("/api/jt-users");
        const json = await res.json();
        if (!res.ok || json.error) {
          setJtErr(json.error || "Could not load JobTread users.");
          return;
        }
        setJtUsers(json.users ?? []);
        setOrgTypes(json.orgTypes ?? []);
      } catch (e) {
        setJtErr(e instanceof Error ? e.message : "Could not load JobTread users.");
      }
    })();
  }, []);

  const jtById = useMemo(() => {
    const m = new Map<string, JtUser>();
    jtUsers.forEach((u) => m.set(u.id, u));
    return m;
  }, [jtUsers]);

  // JobTread user ids already linked to some employee → { id: employee display }.
  const linkedBy = useMemo(() => {
    const m = new Map<string, string>();
    employees.forEach((e) => {
      if (e.jtUserId) m.set(e.jtUserId, `${e.firstName} ${e.lastName}`.trim());
    });
    return m;
  }, [employees]);

  // A confident, unambiguous JobTread match for an unlinked employee (exactly one
  // internal, not-already-linked user matches on name) — drives the one-click Link.
  function suggestFor(e: Employee): JtUser | null {
    if (e.jtUserId) return null;
    const full = norm(`${e.firstName} ${e.lastName}`);
    const first = norm(e.firstName);
    const matches = jtUsers.filter((u) => {
      if (!u.isInternal || linkedBy.has(u.id)) return false;
      const n = norm(u.name);
      if (!n) return false;
      return n === full || n === first || full.includes(n) || n.includes(full);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = employees
      .filter((e) => statusFilter === "All" || e.status === statusFilter)
      .filter((e) => {
        if (!needle) return true;
        return `${e.firstName} ${e.lastName} ${e.position} ${e.email} ${e.phone} ${e.role} ${e.dl} ${e.address} ${e.jtUserName}`
          .toLowerCase()
          .includes(needle);
      });
    rows.sort((a, b) => {
      const pick =
        sortKey === "name"
          ? (e: Employee) => `${e.lastName} ${e.firstName}`
          : sortKey === "position"
            ? (e: Employee) => e.position
            : (e: Employee) => e.status;
      const c = pick(a).localeCompare(pick(b));
      return sortDir === "asc" ? c : -c;
    });
    return rows;
  }, [employees, q, statusFilter, sortKey, sortDir]);

  const linkedCount = useMemo(() => employees.filter((e) => e.jtUserId).length, [employees]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openEdit(e: Employee) {
    setEditing(e);
    setForm({ ...e });
    setSaveErr("");
  }

  // Persist a set of field changes for one employee and merge the result in.
  async function patchEmployee(id: string, fields: Record<string, string>) {
    const res = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, fields }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Save failed.");
    const updated: Employee = json.employee;
    setEmployees((list) => list.map((e) => (e.id === updated.id ? updated : e)));
    if (updated.status && !statuses.includes(updated.status)) {
      setStatuses((s) => [...s, updated.status].sort());
    }
    return updated;
  }

  async function quickLink(e: Employee, u: JtUser) {
    setLinkingId(e.id);
    try {
      await patchEmployee(e.id, { jtUserId: u.id, jtUserName: u.name });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Link failed.");
    } finally {
      setLinkingId("");
    }
  }

  async function save() {
    if (!form || !editing) return;
    // Only changed fields — untouched cells keep their sheet formatting.
    const changes: Record<string, string> = {};
    for (const f of FIELDS) {
      if (form[f.key] !== editing[f.key]) changes[f.key] = form[f.key];
    }
    if (form.jtUserId !== editing.jtUserId) {
      changes.jtUserId = form.jtUserId;
      changes.jtUserName = form.jtUserName;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setSaveErr("");
    try {
      await patchEmployee(editing.id, changes);
      setEditing(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const hasEmail = (e: Employee) => !!e.email.trim();
  const isActive = (e: Employee) => norm(e.status) === "active";

  // Open the composer, defaulting the selection to every Active employee who has
  // an email on file (the common case: "email the crew"). The user can add or
  // remove anyone before sending.
  function openComposer() {
    const active = new Set(employees.filter((e) => isActive(e) && hasEmail(e)).map((e) => e.id));
    setSelectedIds(active);
    setSubject("");
    setEmailBody("");
    setSendErr("");
    setSendResult(null);
    setComposing(true);
  }

  function toggleRecipient(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectAllActive = () =>
    setSelectedIds(new Set(employees.filter((e) => isActive(e) && hasEmail(e)).map((e) => e.id)));
  const selectAllEmailable = () =>
    setSelectedIds(new Set(employees.filter(hasEmail).map((e) => e.id)));
  const selectNone = () => setSelectedIds(new Set());

  // Only selected employees who actually have an email are real recipients.
  const recipientCount = useMemo(
    () => employees.filter((e) => selectedIds.has(e.id) && hasEmail(e)).length,
    [employees, selectedIds],
  );

  async function sendEmail() {
    const ids = employees.filter((e) => selectedIds.has(e.id) && hasEmail(e)).map((e) => e.id);
    if (!ids.length || !subject.trim() || !emailBody.trim()) return;
    setSending(true);
    setSendErr("");
    setSendResult(null);
    try {
      const res = await fetch("/api/employees/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, subject, body: emailBody }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "Send failed.");
      setSendResult({ sent: json.sent ?? ids.length, skipped: json.skipped ?? [] });
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  const SortHead = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="px-3 py-2 text-left font-semibold">
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-accent">
        {label}
        <span className="text-[10px] text-neutral-400">
          {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );

  // The JobTread cell for a table row.
  function JtCell({ e }: { e: Employee }) {
    if (e.jtUserId) {
      const live = jtById.get(e.jtUserId);
      const name = live?.name || e.jtUserName || "linked";
      return (
        <span
          title={live ? `JobTread: ${name}` : `Linked to ${name} (not found in current JobTread users)`}
          className={
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
            (live || !jtUsers.length
              ? "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50"
              : "text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-950/50")
          }
        >
          ✓ {name}
        </span>
      );
    }
    const sug = suggestFor(e);
    if (sug) {
      return (
        <button
          onClick={() => quickLink(e, sug)}
          disabled={linkingId === e.id}
          title={`Link to JobTread user "${sug.name}"`}
          className="inline-flex items-center gap-1 rounded-full border border-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          {linkingId === e.id ? "Linking…" : `Link: ${sug.name}`}
        </button>
      );
    }
    return <span className="text-[11px] text-neutral-400">not in JobTread</span>;
  }

  // Internal users first for the modal dropdown; keep a linked-but-external user
  // visible by appending it if it isn't already listed.
  const dropdownUsers = useMemo(() => {
    const internal = jtUsers.filter((u) => u.isInternal);
    return internal;
  }, [jtUsers]);

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-6">
      <PageHeader
        title="Employees"
        description="The Project Database roster — search, edit, and link people to their JobTread user."
        className="!mb-3"
      />

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, position, email, phone…"
          className={inputCls + " min-w-[12rem] flex-1"}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={inputCls + " w-auto"}
        >
          <option value="All">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={openComposer} disabled={loading || !!loadErr}>
          ✉️ Email employees
        </Button>
      </div>

      {loadErr && (
        <Banner tone="error" className="mb-4">
          {loadErr}
        </Banner>
      )}
      {jtErr && !loadErr && (
        <Banner tone="warning" className="mb-4">
          JobTread users couldn&apos;t load ({jtErr}) — linking is unavailable, existing links still show.
        </Banner>
      )}
      {loading && <Loading label="Loading roster…" />}

      {!loading && !loadErr && (
        <>
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
            <span>
              {view.length} of {employees.length}
            </span>
            <span>{linkedCount} linked to JobTread</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-700/60 dark:bg-ink-raised">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-white/5">
                <tr>
                  <SortHead label="Name" k="name" />
                  <SortHead label="Position" k="position" />
                  <SortHead label="Status" k="status" />
                  <th className="px-3 py-2 text-left font-semibold">JobTread</th>
                  <th className="px-3 py-2 text-left font-semibold">Phone</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {view.map((e) => (
                  <tr key={e.id} className="border-t border-neutral-100 dark:border-neutral-800/70">
                    <td className="px-3 py-2 font-medium">
                      {e.firstName} {e.lastName}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{e.position}</td>
                    <td className="px-3 py-2">
                      {e.status && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass(e.status)}`}
                        >
                          {e.status}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <JtCell e={e} />
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{e.phone}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => openEdit(e)}
                        className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold transition hover:border-accent hover:text-accent dark:border-neutral-600"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {view.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-neutral-500">
                      No matching employees.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Edit modal */}
      {editing && form && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => !saving && setEditing(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-ink-overlay sm:rounded-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-bold">
                {editing.firstName} {editing.lastName}
              </h2>
              <span className="text-xs text-neutral-500">ID: {editing.id}</span>
            </div>

            {/* JobTread link */}
            <div className="mb-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700/60">
              <Label>JobTread user</Label>
              {jtErr ? (
                <p className="text-sm text-neutral-500">Unavailable — JobTread users didn&apos;t load.</p>
              ) : (
                <select
                  value={form.jtUserId}
                  onChange={(ev) => {
                    const id = ev.target.value;
                    const u = jtById.get(id);
                    setForm({ ...form, jtUserId: id, jtUserName: u?.name ?? "" });
                  }}
                  className={inputCls}
                >
                  <option value="">— Not linked —</option>
                  {/* keep a currently-linked user selectable even if external/absent */}
                  {form.jtUserId && !dropdownUsers.some((u) => u.id === form.jtUserId) && (
                    <option value={form.jtUserId}>
                      {jtById.get(form.jtUserId)?.name ?? form.jtUserName ?? form.jtUserId}
                    </option>
                  )}
                  {dropdownUsers.map((u) => {
                    const other = linkedBy.get(u.id);
                    const otherLabel =
                      other && other !== `${editing.firstName} ${editing.lastName}`.trim()
                        ? ` — linked to ${other}`
                        : "";
                    return (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {otherLabel}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                  <Label>{f.label}</Label>
                  {f.key === "status" ? (
                    <select
                      value={form.status}
                      onChange={(ev) => setForm({ ...form, status: ev.target.value })}
                      className={inputCls}
                    >
                      {!statuses.includes(form.status) && form.status !== "" && (
                        <option value={form.status}>{form.status}</option>
                      )}
                      <option value=""></option>
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : f.key === "leavePayType" ? (
                    (() => {
                      // Pay types come from the LINKED JobTread user (per-worker,
                      // each carrying that person's real rate); fall back to the
                      // org-wide names if the grant can't read per-member types.
                      const linked = jtById.get(form.jtUserId);
                      const memberTypes = linked?.types ?? [];
                      const names = memberTypes.length
                        ? memberTypes.map((t) => t.name)
                        : orgTypes;
                      const rateOf = (name: string) => memberTypes.find((t) => t.name === name)?.hourlyRate;
                      return (
                        <select
                          value={form.leavePayType}
                          onChange={(ev) => setForm({ ...form, leavePayType: ev.target.value })}
                          className={inputCls}
                        >
                          <option value="">— None —</option>
                          {form.leavePayType && !names.includes(form.leavePayType) && (
                            <option value={form.leavePayType}>{form.leavePayType}</option>
                          )}
                          {names.map((n) => {
                            const rate = rateOf(n);
                            return (
                              <option key={n} value={n}>
                                {n}
                                {rate != null ? ` — $${rate}/hr` : ""}
                              </option>
                            );
                          })}
                        </select>
                      );
                    })()
                  ) : (
                    <input
                      value={form[f.key]}
                      onChange={(ev) => setForm({ ...form, [f.key]: ev.target.value })}
                      className={inputCls}
                    />
                  )}
                </div>
              ))}
            </div>

            {saveErr && (
              <Banner tone="error" className="mt-3">
                {saveErr}
              </Banner>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Email composer */}
      {composing && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => !sending && setComposing(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white dark:bg-ink-overlay sm:rounded-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-baseline justify-between border-b border-neutral-200 p-4 dark:border-neutral-700/60">
              <h2 className="text-lg font-bold">Email employees</h2>
              <span className="text-xs text-neutral-500">from office@ascentbuildingco.com</span>
            </div>

            {sendResult ? (
              // Success / result state
              <div className="overflow-y-auto p-4">
                <Banner tone="success" className="mb-3">
                  Sent to {sendResult.sent} employee{sendResult.sent === 1 ? "" : "s"}.
                </Banner>
                {sendResult.skipped.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
                    <p className="mb-1 font-semibold text-amber-800 dark:text-amber-300">
                      Skipped {sendResult.skipped.length} (no usable email):
                    </p>
                    <ul className="list-inside list-disc text-amber-800 dark:text-amber-300/90">
                      {sendResult.skipped.map((s) => (
                        <li key={s.id}>
                          {s.name} — {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Button className="w-full" onClick={() => setComposing(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <>
                {/* Recipient picker */}
                <div className="border-b border-neutral-200 px-4 pb-2 pt-3 dark:border-neutral-700/60">
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="!mb-0">
                      Recipients — {recipientCount} selected
                    </Label>
                    <div className="flex gap-1 text-[11px] font-semibold">
                      <button onClick={selectAllActive} className="rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">
                        All active
                      </button>
                      <button onClick={selectAllEmailable} className="rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">
                        All
                      </button>
                      <button onClick={selectNone} className="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10">
                        None
                      </button>
                    </div>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-700/60">
                    {employees.map((e) => {
                      const emailable = hasEmail(e);
                      return (
                        <label
                          key={e.id}
                          className={
                            "flex items-center gap-2 border-b border-neutral-100 px-2 py-1.5 text-sm last:border-b-0 dark:border-neutral-800/70 " +
                            (emailable ? "cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/5" : "opacity-50")
                          }
                        >
                          <input
                            type="checkbox"
                            disabled={!emailable}
                            checked={selectedIds.has(e.id)}
                            onChange={() => toggleRecipient(e.id)}
                            className="h-4 w-4 accent-accent"
                          />
                          <span className="font-medium">
                            {e.firstName} {e.lastName}
                          </span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(e.status)}`}>
                            {e.status || "—"}
                          </span>
                          <span className="ml-auto truncate text-xs text-neutral-500">
                            {emailable ? e.email : "no email"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Message */}
                <div className="overflow-y-auto p-4">
                  <div className="mb-3">
                    <Label>Subject</Label>
                    <input
                      value={subject}
                      onChange={(ev) => setSubject(ev.target.value)}
                      placeholder="Subject line"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <Label>Message</Label>
                    <Textarea
                      value={emailBody}
                      onChange={(ev) => setEmailBody(ev.target.value)}
                      rows={7}
                      placeholder="Write your message…"
                    />
                  </div>

                  {sendErr && (
                    <Banner tone="error" className="mt-3">
                      {sendErr}
                    </Banner>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setComposing(false)}
                      disabled={sending}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={sendEmail}
                      disabled={
                        sending || recipientCount === 0 || !subject.trim() || !emailBody.trim()
                      }
                    >
                      {sending
                        ? "Sending…"
                        : `Send to ${recipientCount} employee${recipientCount === 1 ? "" : "s"}`}
                    </Button>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-neutral-400">
                    Everyone is on the To line and can see who else received it.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
