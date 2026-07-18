"use client";

import { useEffect, useMemo, useState } from "react";

import { PageTitle } from "@/components/PageTitle";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  status: string;
  phone: string;
  email: string;
  address: string;
  birthday: string;
  dl: string;
  role: string;
}

type EditableKey = keyof Omit<Employee, "id">;

const FIELDS: { key: EditableKey; label: string; wide?: boolean }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "position", label: "Position" },
  { key: "status", label: "Status" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "birthday", label: "Birthday" },
  { key: "dl", label: "Driver's license" },
  { key: "role", label: "Role" },
  { key: "address", label: "Address", wide: true },
];

type SortKey = "name" | "position" | "status";

const statusClass = (s: string) => {
  const k = s.toLowerCase();
  if (k === "active") return "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50";
  if (k === "retired") return "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800";
  return "text-accent bg-accent/10";
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
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
  }, []);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = employees
      .filter((e) => statusFilter === "All" || e.status === statusFilter)
      .filter((e) => {
        if (!needle) return true;
        return `${e.firstName} ${e.lastName} ${e.position} ${e.email} ${e.phone} ${e.role} ${e.dl} ${e.address}`
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

  async function save() {
    if (!form || !editing) return;
    // Send only changed editable fields — untouched cells keep their sheet format.
    const changes: Partial<Record<EditableKey, string>> = {};
    for (const f of FIELDS) {
      if (form[f.key] !== editing[f.key]) changes[f.key] = form[f.key];
    }
    if (Object.keys(changes).length === 0) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setSaveErr("");
    try {
      const res = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, fields: changes }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setSaveErr(json.error || "Save failed.");
        return;
      }
      const updated: Employee = json.employee;
      setEmployees((list) => list.map((e) => (e.id === updated.id ? updated : e)));
      if (updated.status && !statuses.includes(updated.status)) {
        setStatuses((s) => [...s, updated.status].sort());
      }
      setEditing(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";

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

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-6">
      <PageTitle>Employees</PageTitle>

      {/* Controls */}
      <div className="mb-3 mt-3 flex flex-wrap items-center gap-2">
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
      </div>

      {loadErr && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {loadErr}
        </div>
      )}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      {!loading && !loadErr && (
        <>
          <div className="mb-2 text-xs text-neutral-500">
            {view.length} of {employees.length}
          </div>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <SortHead label="Name" k="name" />
                  <SortHead label="Position" k="position" />
                  <SortHead label="Status" k="status" />
                  <th className="px-3 py-2 text-left font-semibold">Phone</th>
                  <th className="px-3 py-2 text-left font-semibold">Email</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {view.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t border-neutral-100 dark:border-neutral-800/70"
                  >
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
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{e.phone}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 text-neutral-600 dark:text-neutral-400">
                      {e.email}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => openEdit(e)}
                        className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
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
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-neutral-900 sm:rounded-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-bold">
                {editing.firstName} {editing.lastName}
              </h2>
              <span className="text-xs text-neutral-500">ID: {editing.id}</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                  <label className="mb-1 block text-xs font-semibold text-neutral-500">{f.label}</label>
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
              <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {saveErr}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
