"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Loading, PageHeader, inputCls } from "@/components/ui";

interface Group {
  id: number; // 0 = the virtual Global group
  name: string;
  sortOrder: number;
}
interface CatalogRate {
  id: number;
  name: string; // short rate name, e.g. "Regular Pay"
  groupId: number; // 0 = Global (no prefix)
  hourlyRate: string; // stored as text
  sortOrder: number;
}
interface PayType {
  name: string;
  hourlyRate: number;
}
interface Member {
  membershipId: string;
  userId: string;
  name: string;
  types: PayType[];
  ratesReadable: boolean;
}

const GLOBAL: Group = { id: 0, name: "Global", sortOrder: -1 };
// Leave pay types the Time-Off feature posts against — warn before removing one.
const PROTECTED = new Set(["paid time off", "sick pay"]);
const isProtected = (name: string) => PROTECTED.has(name.trim().toLowerCase());
const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}/hr`;
const rateNum = (r: CatalogRate) => Number(r.hourlyRate) || 0;
// The JobTread pay-type name: Global (0) pushes the rate name verbatim; a real
// group prepends "<group> - ".
const effName = (groupId: number, rateName: string, groups: Map<number, Group>) =>
  groupId === 0 ? rateName : `${groups.get(groupId)?.name ?? "?"} - ${rateName}`;

/** One group's rates + inline add-rate form. Module-scope so its input keeps focus. */
function GroupSection({
  group,
  rates,
  onAddRate,
  onPatchRate,
  onDeleteRate,
  onRenameGroup,
  onDeleteGroup,
}: {
  group: Group;
  rates: CatalogRate[];
  onAddRate: (groupId: number, name: string, hourlyRate: string) => Promise<void> | void;
  onPatchRate: (id: number, fields: Partial<CatalogRate>) => void;
  onDeleteRate: (id: number) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
}) {
  const [nm, setNm] = useState("");
  const [rt, setRt] = useState("");
  const isGlobal = group.id === 0;
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-line bg-white dark:bg-ink-raised">
      <div className="flex items-center gap-2 border-b border-line-soft bg-neutral-50 px-3 py-2 dark:border-neutral-800/70 dark:bg-white/5">
        {isGlobal ? (
          <span className="text-sm font-bold">🌐 Global <span className="font-normal text-neutral-500">— pushes with no prefix</span></span>
        ) : (
          <>
            <input
              defaultValue={group.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== group.name && onRenameGroup(group.id, e.target.value.trim())}
              className={inputCls + " max-w-[16rem] flex-1 font-semibold"}
            />
            <span className="text-[11px] text-neutral-400">pushes as “{group.name} - …”</span>
            <button onClick={() => onDeleteGroup(group.id)} title="Delete group" className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
              Delete group
            </button>
          </>
        )}
      </div>

      {rates.map((r) => (
        <div key={r.id} className="flex items-center gap-2 border-b border-line-soft px-3 py-2 last:border-b-0 dark:border-neutral-800/70">
          <input
            defaultValue={r.name}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.name && onPatchRate(r.id, { name: e.target.value.trim() })}
            className={inputCls + " flex-1"}
          />
          <div className="relative w-28">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
            <input
              defaultValue={r.hourlyRate}
              inputMode="decimal"
              onBlur={(e) => e.target.value.trim() !== r.hourlyRate && onPatchRate(r.id, { hourlyRate: e.target.value.trim() })}
              className={inputCls + " pl-5"}
            />
          </div>
          <button onClick={() => onDeleteRate(r.id)} title="Delete rate" className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">✕</button>
        </div>
      ))}
      {rates.length === 0 && <p className="px-3 py-2 text-sm text-neutral-400">No rates in this group yet.</p>}

      <div className="flex items-center gap-2 px-3 py-2">
        <input
          value={nm}
          onChange={(e) => setNm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && nm.trim() && (onAddRate(group.id, nm.trim(), rt), setNm(""), setRt(""))}
          placeholder={isGlobal ? "Rate name — e.g. Regular Pay" : "Rate name — e.g. Tile"}
          className={inputCls + " flex-1"}
        />
        <div className="relative w-28">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
          <input value={rt} onChange={(e) => setRt(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls + " pl-5"} />
        </div>
        <Button
          variant="secondary"
          onClick={() => nm.trim() && (onAddRate(group.id, nm.trim(), rt), setNm(""), setRt(""))}
          disabled={!nm.trim()}
        >
          Add rate
        </Button>
      </div>
    </div>
  );
}

export default function LaborRatesPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [rates, setRates] = useState<CatalogRate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [jtErr, setJtErr] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [newGroup, setNewGroup] = useState("");

  // per-member editor (exact replace of the shown, ORDERED list)
  const [editing, setEditing] = useState<Member | null>(null);
  const [draft, setDraft] = useState<PayType[]>([]);
  const [addCatalogId, setAddCatalogId] = useState<string>("");

  // bulk apply
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRateId, setBulkRateId] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const [gRes, cRes, mRes] = await Promise.all([
        fetch("/api/labor-rates/groups"),
        fetch("/api/labor-rates"),
        fetch("/api/labor-rates/members"),
      ]);
      const gJson = await gRes.json();
      if (gRes.ok) setGroups(gJson.groups ?? []);
      const cJson = await cRes.json();
      if (!cRes.ok) setLoadErr(cJson.error || "Could not load the rate catalog.");
      else setRates(cJson.rates ?? []);
      const mJson = await mRes.json();
      if (!mRes.ok) setJtErr(mJson.error || "Could not load employees from JobTread.");
      else setMembers(mJson.members ?? []);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const groupsById = useMemo(() => {
    const m = new Map<number, Group>([[0, GLOBAL]]);
    groups.forEach((g) => m.set(g.id, g));
    return m;
  }, [groups]);

  // Global first, then real groups in their order.
  const orderedGroups = useMemo(
    () => [GLOBAL, ...[...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))],
    [groups],
  );
  const ratesOf = (groupId: number) =>
    rates.filter((r) => r.groupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  // Every catalog rate as an effective-name option (for dropdowns), grouped label.
  const rateOptions = useMemo(
    () =>
      rates
        .map((r) => ({ id: r.id, label: effName(r.groupId, r.name, groupsById), hourlyRate: rateNum(r) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [rates, groupsById],
  );

  // ---- group CRUD ----
  async function addGroup() {
    const name = newGroup.trim();
    if (!name || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/labor-rates/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Add failed.");
      setGroups((g) => [...g, json.group]);
      setNewGroup("");
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Add failed." });
    } finally {
      setBusy(false);
    }
  }
  async function renameGroup(id: number, name: string) {
    const res = await fetch("/api/labor-rates/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
    const json = await res.json();
    if (!res.ok) return setNotice({ tone: "error", text: json.error || "Rename failed." });
    setGroups((g) => g.map((x) => (x.id === id ? json.group : x)));
  }
  async function deleteGroup(id: number) {
    if (!confirm("Delete this group and its rate definitions? (Employees keep any rates already pushed to JobTread.)")) return;
    const res = await fetch(`/api/labor-rates/groups?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setGroups((g) => g.filter((x) => x.id !== id));
      setRates((r) => r.filter((x) => x.groupId !== id));
    }
  }

  // ---- rate CRUD ----
  async function addRate(groupId: number, name: string, hourlyRate: string) {
    setNotice(null);
    const res = await fetch("/api/labor-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, groupId, hourlyRate }),
    });
    const json = await res.json();
    if (!res.ok) return setNotice({ tone: "error", text: json.error || "Add failed." });
    setRates((r) => [...r, json.rate]);
  }
  async function patchRate(id: number, fields: Partial<CatalogRate>) {
    const res = await fetch("/api/labor-rates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    const json = await res.json();
    if (!res.ok) return setNotice({ tone: "error", text: json.error || "Save failed." });
    setRates((r) => r.map((x) => (x.id === id ? json.rate : x)));
  }
  async function deleteRate(id: number) {
    const res = await fetch(`/api/labor-rates?id=${id}`, { method: "DELETE" });
    if (res.ok) setRates((r) => r.filter((x) => x.id !== id));
  }

  // ---- apply response handling ----
  function applyResult(json: { wrote?: boolean; previewed?: boolean; message?: string; results?: { membershipId: string; ok: boolean; error?: string; types?: PayType[] }[] }) {
    if (json.previewed) {
      setNotice({ tone: "warning", text: json.message || "Writes are OFF — nothing was sent to JobTread." });
      return false;
    }
    const results = json.results ?? [];
    setMembers((ms) =>
      ms.map((m) => {
        const r = results.find((x) => x.membershipId === m.membershipId && x.ok && x.types);
        return r ? { ...m, types: r.types as PayType[] } : m;
      }),
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length) setNotice({ tone: "error", text: `${failed.length} update(s) failed: ${failed.map((f) => f.error).join("; ")}` });
    else setNotice({ tone: "success", text: `Updated ${results.length} employee${results.length === 1 ? "" : "s"} in JobTread.` });
    return failed.length === 0;
  }

  // ---- per-member editor (exact replace, ordered) ----
  function openEditor(m: Member) {
    setEditing(m);
    setDraft(m.types.map((t) => ({ name: t.name, hourlyRate: t.hourlyRate })));
    setAddCatalogId("");
  }
  function draftAdd(name: string, hourlyRate: number) {
    setDraft((d) => (d.some((t) => t.name === name) ? d.map((t) => (t.name === name ? { ...t, hourlyRate } : t)) : [...d, { name, hourlyRate }]));
  }
  function draftAddFromCatalog() {
    const opt = rateOptions.find((o) => String(o.id) === addCatalogId);
    if (!opt) return;
    draftAdd(opt.label, opt.hourlyRate);
    setAddCatalogId("");
  }
  function move(i: number, dir: -1 | 1) {
    setDraft((d) => {
      const n = [...d];
      const j = i + dir;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }
  async function saveEditor() {
    if (!editing || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/labor-rates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "set", membershipId: editing.membershipId, types: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed.");
      const ok = applyResult(json);
      if (ok || json.previewed) setEditing(null);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Save failed." });
    } finally {
      setBusy(false);
    }
  }

  // ---- bulk apply one catalog rate to selected members ----
  const bulkRate = useMemo(() => rateOptions.find((o) => String(o.id) === bulkRateId) || null, [rateOptions, bulkRateId]);
  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function bulkApply() {
    if (!bulkRate || !selected.size || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/labor-rates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "applyRate", membershipIds: [...selected], rate: { name: bulkRate.label, hourlyRate: bulkRate.hourlyRate } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Apply failed.");
      applyResult(json);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Apply failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-6">
      <PageHeader
        title="Labor Rates"
        description="Group per-project pay rates, then choose which employees have each. Pushing writes to JobTread as “Group - Rate”."
        className="!mb-3"
      />

      {notice && <Banner tone={notice.tone} className="mb-4">{notice.text}</Banner>}
      {loadErr && <Banner tone="error" className="mb-4">{loadErr}</Banner>}
      {loading && <Loading label="Loading rates…" />}

      {!loading && (
        <>
          {/* ---- Catalog (grouped) ---- */}
          <section className="mb-8">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">Rate catalog</h2>
            {orderedGroups.map((g) => (
              <GroupSection
                key={g.id}
                group={g}
                rates={ratesOf(g.id)}
                onAddRate={addRate}
                onPatchRate={patchRate}
                onDeleteRate={deleteRate}
                onRenameGroup={renameGroup}
                onDeleteGroup={deleteGroup}
              />
            ))}
            <div className="mt-2 flex items-center gap-2">
              <input
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGroup()}
                placeholder="New group (project) — e.g. Berger Bunkhouse"
                className={inputCls + " max-w-sm flex-1"}
              />
              <Button onClick={addGroup} disabled={busy || !newGroup.trim()}>Add group</Button>
            </div>
          </section>

          {/* ---- Employees ---- */}
          {jtErr ? (
            <Banner tone="warning" className="mb-4">Employees couldn’t load from JobTread ({jtErr}).</Banner>
          ) : (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">Employees &amp; their rates</h2>

              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3 dark:bg-ink-raised">
                <span className="text-sm font-semibold">Bulk apply:</span>
                <select value={bulkRateId} onChange={(e) => setBulkRateId(e.target.value)} className={inputCls + " w-auto max-w-[18rem]"}>
                  <option value="">Pick a rate…</option>
                  {rateOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label} — {money(o.hourlyRate)}</option>
                  ))}
                </select>
                <span className="text-sm text-neutral-500">to {selected.size} selected</span>
                <Button onClick={bulkApply} disabled={busy || !bulkRate || !selected.size}>Apply</Button>
                {selected.size > 0 && (
                  <button onClick={() => setSelected(new Set())} className="text-xs font-semibold text-neutral-500 hover:text-accent">clear</button>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-ink-raised">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-neutral-50 text-neutral-500 dark:bg-white/5">
                    <tr>
                      <th className="w-8 px-3 py-2" />
                      <th className="px-3 py-2 text-left font-semibold">Employee</th>
                      <th className="px-3 py-2 text-left font-semibold">Rates (in push order)</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.membershipId} className="border-t border-line-soft align-top dark:border-neutral-800/70">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(m.membershipId)} onChange={() => toggle(m.membershipId)} className="h-4 w-4 accent-accent" />
                        </td>
                        <td className="px-3 py-2 font-medium">{m.name}</td>
                        <td className="px-3 py-2">
                          {m.types.length === 0 ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {m.types.map((t, i) => (
                                <span key={`${t.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] dark:bg-white/10">
                                  <span className="font-medium">{t.name}</span>
                                  <span className="tabular-nums text-neutral-500">{money(t.hourlyRate)}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => openEditor(m)} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold transition hover:border-accent hover:text-accent dark:border-neutral-600">
                            Edit rates
                          </button>
                        </td>
                      </tr>
                    ))}
                    {members.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-neutral-500">No internal employees found in JobTread.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* ---- per-member editor modal (exact replace, ordered) ---- */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !busy && setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-ink-overlay sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-lg font-bold">{editing.name}</h2>
              <span className="text-xs text-neutral-500">rates in JobTread</span>
            </div>
            <p className="mb-3 text-[11px] text-neutral-400">
              Saving sets this employee’s pay types to exactly this list, in this order (removing any you delete here). Use ↑/↓ to set the push order.
            </p>

            <div className="space-y-2">
              {draft.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="flex flex-col">
                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" className="px-1 text-xs text-neutral-500 hover:text-accent disabled:opacity-30">▲</button>
                    <button onClick={() => move(i, 1)} disabled={i === draft.length - 1} title="Move down" className="px-1 text-xs text-neutral-500 hover:text-accent disabled:opacity-30">▼</button>
                  </div>
                  <input
                    value={t.name}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className={inputCls + " flex-1"}
                  />
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                    <input
                      value={String(t.hourlyRate)}
                      inputMode="decimal"
                      onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, hourlyRate: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } : x)))}
                      className={inputCls + " pl-5"}
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (isProtected(t.name) && !confirm(`“${t.name}” is used to post time off. Remove it anyway?`)) return;
                      setDraft((d) => d.filter((_, j) => j !== i));
                    }}
                    title="Remove"
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {draft.length === 0 && <p className="text-sm text-neutral-500">No pay types — add one below.</p>}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <select value={addCatalogId} onChange={(e) => setAddCatalogId(e.target.value)} className={inputCls + " flex-1"}>
                <option value="">Add from catalog…</option>
                {rateOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label} — {money(o.hourlyRate)}</option>
                ))}
              </select>
              <Button variant="secondary" onClick={draftAddFromCatalog} disabled={!addCatalogId}>Add</Button>
            </div>
            <button onClick={() => setDraft((d) => [...d, { name: "", hourlyRate: 0 }])} className="mt-2 text-xs font-semibold text-accent hover:underline">
              + Add a custom rate
            </button>

            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={saveEditor} disabled={busy || draft.length > 20}>
                {busy ? "Saving…" : "Save to JobTread"}
              </Button>
            </div>
            {draft.length > 20 && <p className="mt-2 text-center text-[11px] text-red-600">JobTread allows at most 20 pay types per employee.</p>}
          </div>
        </div>
      )}
    </main>
  );
}
