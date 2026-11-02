/**
 * The browser half of "Split bill" — one call and one outcome message for every
 * host of the coding card (the bill page, the Tracking Sheets board, the draft
 * workbench), so the three cannot word it differently. See /api/split-bill.
 */
export async function postSplitBill(
  docId: string,
  lineIds: string[],
): Promise<{ ok: boolean; text: string; newDocId?: string }> {
  try {
    const res = await fetch("/api/split-bill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId, lineIds }),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, text: j.error ?? "Split failed." };
    if (j.previewed) return { ok: false, text: "Preview only — writes are OFF. Nothing was split in JobTread." };
    const n = lineIds.length;
    const pdf =
      j.fileErrors?.length > 0
        ? ` The PDF did not copy (${j.fileErrors.join("; ")}) — attach it in JobTread.`
        : j.filesCopied > 0
          ? " PDF copied."
          : "";
    return {
      ok: true,
      text: `Split: ${n} line${n === 1 ? "" : "s"} moved to new draft bill ${j.externalId}.${pdf}`,
      newDocId: j.newDocId,
    };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Network error" };
  }
}
