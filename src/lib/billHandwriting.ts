import { inArray } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { billHandwriting } from "@/db/schema";
import { isHandwrittenWithClaude } from "@/lib/claudeExtract";
import { isJobTreadFileUrl } from "@/lib/fileReader";
import { getBillFiles, type PaveConfig } from "@/lib/jobtread";

/**
 * Which bills carry a HANDWRITTEN invoice — the ✍ chip on the bill lists.
 *
 * Claude looks at each bill's scan once: JobTread's page-1 JPEG of the first
 * attached file (`imageUrl`, the same render the coding card shows), a small
 * image to the small model. The answer is kept in `bill_handwriting`, so a bill
 * is never sent twice. A bill with no file yet, or a read that fails, is not
 * kept, so the next list load tries it again. Read-only toward JobTread.
 */

/** New bills looked at per call — the lists call again for the rest. */
export const HANDWRITING_BATCH = 6;

export async function billHandwritingFor(
  cfg: PaveConfig,
  docIds: string[],
): Promise<{ handwritten: string[]; pending: number }> {
  const ids = [...new Set(docIds.map((d) => d.trim()).filter(Boolean))].slice(0, 500);
  if (!ids.length) return { handwritten: [], pending: 0 };
  await ensureDb();
  const known = await db.select().from(billHandwriting).where(inArray(billHandwriting.docId, ids));
  const done = new Set(known.map((r) => r.docId));
  const handwritten = known.filter((r) => r.handwritten).map((r) => r.docId);

  const todo = ids.filter((d) => !done.has(d));
  const batch = todo.slice(0, HANDWRITING_BATCH);
  const results = await Promise.all(batch.map((d) => checkOne(cfg, d)));
  let failed = 0;
  for (const r of results) {
    if (!r) {
      failed++;
      continue;
    }
    await db
      .insert(billHandwriting)
      .values(r)
      .onConflictDoUpdate({ target: billHandwriting.docId, set: r });
    if (r.handwritten) handwritten.push(r.docId);
  }
  // A bill that could not be read stays out of the table and out of `pending`,
  // so the list does not loop on it; the next load tries it again.
  return { handwritten, pending: todo.length - batch.length };
}

async function checkOne(cfg: PaveConfig, docId: string) {
  try {
    const file = (await getBillFiles(cfg, docId)).find((f) => f.imageUrl && isJobTreadFileUrl(f.imageUrl));
    if (!file?.imageUrl) return null;
    const res = await fetch(file.imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const bytes = Buffer.from(await res.arrayBuffer());
    const handwritten = await isHandwrittenWithClaude(bytes, mime);
    return { docId, fileId: file.id, handwritten, checkedAt: new Date().toISOString() };
  } catch (e) {
    console.error(`[billHandwriting] ${docId}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
