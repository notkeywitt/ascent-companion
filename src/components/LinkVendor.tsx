"use client";

import { useEffect, useState } from "react";
import { Button, Select } from "@/components/ui";

/**
 * "This vendor is in JobTread, under another name." A bill whose vendor didn't
 * resolve (the invoice reads "A1 Septic on Lopez LLC", JobTread calls it
 * "A1 Septic") gets pointed at the existing vendor instead of a duplicate being
 * created.
 *
 * The Apps Script `linkVendor` action does the work: it learns the name on the
 * Vendor Aliases tab, so the next invoice read under it lands on the same
 * vendor, and it moves every not-yet-pushed bill holding the name. Sheet only —
 * the bill reaches JobTread on its next push.
 *
 * `endpoint` is the route of the surface it sits on (/api/uncaptured,
 * /api/stuck-vendors), so it rides that surface's view gate.
 */
export function LinkVendor({
  expId,
  endpoint,
  onLinked,
}: {
  expId: string;
  endpoint: string;
  onLinked: (linked: { vendorId: string; vendor: string; moved: string[] }) => void;
}) {
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => setVendors(j.vendors ?? []))
      .catch(() => setError("Could not load the JobTread vendor list."));
  }, []);

  async function link() {
    if (!pick || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expId, linkAccountId: pick }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false || json?.error) throw new Error(json?.error || "Could not link the vendor.");
      onLinked({ vendorId: String(json.vendorId), vendor: String(json.vendor), moved: json.moved ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy} className="min-w-0 flex-1">
          <option value="">{vendors.length ? "Pick the JobTread vendor…" : "Loading vendors…"}</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => void link()} disabled={!pick || busy}>
          {busy ? "Linking…" : "Link"}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}
