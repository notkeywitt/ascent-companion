"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui";

export interface VendorRef {
  /** The JobTread vendor account id. */
  id: string;
  name: string;
}

/**
 * The "Change vendor" picker in a bill's Filing section. Like the job picker
 * beside it, it is an action: it always shows its prompt, and picking a vendor
 * hands it to `onPick` (which confirms, then starts the void+recreate).
 * The list is the org's JobTread vendor accounts (/api/vendors, cached).
 */
export function ChangeVendor({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (v: VendorRef) => void;
}) {
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => {
        if (live) setVendors(((j.vendors ?? []) as VendorRef[]).slice().sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <Select
      id="filing-change-vendor"
      value=""
      disabled={disabled || vendors.length === 0}
      onChange={(e) => {
        const v = vendors.find((x) => x.id === e.target.value);
        if (v) onPick(v);
      }}
    >
      <option value="">
        {failed ? "Could not load vendors" : vendors.length ? "— choose vendor —" : "Loading vendors…"}
      </option>
      {vendors.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </Select>
  );
}
