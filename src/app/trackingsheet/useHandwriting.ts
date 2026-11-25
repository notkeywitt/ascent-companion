"use client";

import { useEffect, useState } from "react";

/**
 * The bills in this list whose invoice is handwritten — the ✍ chip. Asks
 * /api/bill-handwriting, which looks at a few new bills per call, and asks
 * again while it reports more pending. A failure leaves the chips off.
 */
export function useHandwriting(docIds: string[]): Set<string> {
  const [found, setFound] = useState<Set<string>>(() => new Set());
  const key = [...docIds].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      // ponytail: at most 30 rounds (~180 new bills) per list load; the rest on the next load.
      for (let round = 0; live && round < 30; round++) {
        const r = await fetch("/api/bill-handwriting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docIds: key.split(",") }),
        }).catch(() => null);
        const j = r?.ok ? ((await r.json().catch(() => null)) as { handwritten?: string[]; pending?: number } | null) : null;
        if (!live || !j) return;
        setFound(new Set(j.handwritten ?? []));
        if (!j.pending) return;
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);

  return found;
}
