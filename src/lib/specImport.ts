import { db, ensureDb } from "@/db";
import { specFiles, specLists } from "@/db/schema";
import { extractSpecListWithClaude } from "@/lib/claudeExtract";
import { extractPdfLinks } from "@/lib/pdfLinks";
import { resolveSpecList, type RawSpecList, type SpecList } from "@/lib/specList";

/** The largest PDF the reader takes. */
export const SPEC_PDF_MAX = 20 * 1024 * 1024;
/** The largest PDF kept for the Specifications page's PDF view. Bigger files keep their rows only. */
const PDF_KEEP_MAX = 8 * 1024 * 1024;

/**
 * Read a spec list PDF and store it as the job's newest import — the one path
 * behind both an upload on /specs and a Drive file on /house-manual. Throws a
 * message fit to show when the PDF cannot be read as a schedule.
 */
export async function importSpecPdf(input: {
  jobId: string;
  fileName: string;
  bytes: Buffer;
  importedBy: string;
}): Promise<{ id: number; list: SpecList }> {
  const { jobId, bytes } = input;
  const fileName = input.fileName.slice(0, 200);
  if (bytes.length > SPEC_PDF_MAX) throw new Error("The PDF is over 20 MB.");
  const links = await extractPdfLinks(new Uint8Array(bytes));
  const raw = await extractSpecListWithClaude(bytes, links);
  if (!raw || typeof raw !== "object") throw new Error("The reader could not read this PDF as a schedule.");
  const list = resolveSpecList(raw as RawSpecList, links);
  if (list.rows.length === 0) throw new Error("No rows were found in this PDF.");

  await ensureDb();
  const [saved] = await db
    .insert(specLists)
    .values({
      jobId,
      fileName,
      value: JSON.stringify(list),
      importedAt: new Date().toISOString(),
      importedBy: input.importedBy,
    })
    .returning({ id: specLists.id });
  if (bytes.length <= PDF_KEEP_MAX) {
    await db.insert(specFiles).values({ listId: saved.id, name: fileName, bytes });
  }
  return { id: saved.id, list };
}
