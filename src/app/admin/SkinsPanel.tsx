"use client";

import { useEffect, useState } from "react";

import { Banner, Card, Loading, Select } from "@/components/ui";
import { toast } from "@/components/Toast";
import { PALETTES, PALETTE_LABEL } from "@/lib/palette";

/**
 * Admin → Skins — set the skin for one person. A set skin paints on every
 * device that person signs in on and locks their Skin picker in Appearance.
 * "Their choice" removes it, and each device goes back to its own pick.
 *
 * People come from /api/team (founders + added members); skins from
 * /api/admin/skins.
 */
export function SkinsPanel() {
  const [people, setPeople] = useState<string[]>([]);
  const [skins, setSkins] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/team"), fetch("/api/admin/skins")])
      .then(async ([t, s]) => {
        if (!t.ok || !s.ok) throw new Error("Could not load the team.");
        const team = await t.json();
        const emails = new Set<string>([
          ...((team.envAdmins ?? []) as string[]),
          ...((team.members ?? []) as { email: string }[]).map((m) => m.email),
        ]);
        setPeople([...emails].map((e) => e.toLowerCase()).sort());
        setSkins((await s.json()).skins ?? {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function pick(email: string, palette: string) {
    setSaving(email);
    setError(null);
    try {
      const res = await fetch("/api/admin/skins", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, palette: palette || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed.");
      setSkins((await res.json()).skins ?? {});
      toast("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        A set skin shows on every device the person signs in on, and they cannot change it.
        It applies the next time they open a page.
      </p>
      {error && <Banner tone="error" className="mb-3">{error}</Banner>}
      <Card pad={false} className="divide-y divide-line-soft">
        {people.map((email) => (
          <div key={email} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 truncate text-sm">{email}</span>
            <Select
              aria-label={`Skin for ${email}`}
              className="!w-40 shrink-0"
              value={skins[email] ?? ""}
              disabled={saving === email}
              onChange={(e) => pick(email, e.target.value)}
            >
              <option value="">Their choice</option>
              {PALETTES.map((p) => (
                <option key={p} value={p}>
                  {PALETTE_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </Card>
    </div>
  );
}
