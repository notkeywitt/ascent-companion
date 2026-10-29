import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { fileTexts } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { ocrScanWithClaude } from "@/lib/claudeExtract";
import { driveIdFromLink } from "@/lib/houseManual";
import { getFileById, type PaveConfig } from "@/lib/jobtread";
import { extractPdfText } from "@/lib/pdfLinks";
import { findSnippets, pageText, scanText } from "@/lib/specDocs";

/**
 * AscentBot's file reader: open ONE file — a Drive file (from search_drive) or
 * a JobTread attachment (from get_job_files) — and hand back its text a few
 * pages at a time, or the pages that mention some words.
 *
 * The bytes come the way the rest of the app already fetches them: a Drive file
 * through the Apps Script bridge (JobFiles.js exports a Doc, Sheet or Slides
 * file to PDF), a JobTread file from its cdn.jobtread.com link and nowhere else.
 * A Drive file must sit under JOB_FOLDERS_DRIVE_ID, the same tree search_drive
 * keeps to: a link inside an email or a document cannot send the bot to the
 * rest of the office's Drive.
 * The text layer is pulled with pdf.js, no model. A scan has none, so Claude
 * reads a short one (`ocrScanWithClaude`).
 *
 * The text is kept in `file_texts`, so the next page or the next question costs
 * no second fetch. A JobTread file never changes; a Drive file is read again
 * after DRIVE_FRESH_MS. A failed read is never kept, so it is tried again.
 *
 * The waits are short by default: Google Chat gives an inline answer 25 s, and
 * the /chat page 60 s. A caller that can answer later (AscentBot with its
 * service account) runs the read inside `readerTime.run(LONG_READ, …)` and gets
 * longer waits and longer scans. Read-only everywhere. Server-only.
 */

/** Characters of text handed back per call — about three dense pages. */
const CHUNK_CHARS = 8_000;
/** Text kept per file, about 100 dense pages (the same ceiling as /specs). */
const TEXT_MAX = 400_000;
export interface ReaderTime {
  fetchMs: number;
  /** A scan is read only when short enough to finish inside the answer. */
  ocrPages: number;
  ocrMs: number;
}
const QUICK_READ: ReaderTime = { fetchMs: 15_000, ocrPages: 4, ocrMs: 15_000 };
/** For an answer posted later: the 300 s route, after the rounds before the read. */
export const LONG_READ: ReaderTime = { fetchMs: 60_000, ocrPages: 10, ocrMs: 120_000 };
export const readerTime = new AsyncLocalStorage<ReaderTime>();
const limits = () => readerTime.getStore() ?? QUICK_READ;
const BYTES_MAX = 20 * 1024 * 1024;
const DRIVE_FRESH_MS = 24 * 60 * 60 * 1000;

export interface FileSource {
  /** A Drive link or file id. */
  drive?: string;
  /** A JobTread file id. */
  jobtreadFileId?: string;
}

interface Read {
  key: string;
  name: string;
  pages: number;
  text: string;
  note: string;
}

/** Only JobTread's own file host is fetched, so a link in a document cannot point the server elsewhere. */
export const isJobTreadFileUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "cdn.jobtread.com";
  } catch {
    return false;
  }
};

/** A PDF's bytes → its text, page by page; a short scan read by Claude. */
async function textOf(bytes: Uint8Array): Promise<{ pages: number; text: string; note: string }> {
  const read = await extractPdfText(bytes);
  if (read.text.replace(/\[Page \d+\]/g, "").trim()) return { pages: read.pages, text: read.text, note: "" };
  const { ocrPages, ocrMs } = limits();
  if (read.pages > ocrPages) {
    return {
      pages: read.pages,
      text: "",
      note: `A scan of ${read.pages} pages. Only a scan of ${ocrPages} pages or fewer can be read in time; give the link.`,
    };
  }
  const text = scanText(await ocrScanWithClaude(Buffer.from(bytes), ocrMs));
  return { pages: read.pages, text, note: "A scan, read by AI. Check key numbers against the file." };
}

async function fetchDrive(id: string): Promise<Omit<Read, "key"> | string> {
  const rootId = process.env.JOB_FOLDERS_DRIVE_ID?.trim();
  if (!rootId) return "Drive reading is not set up (JOB_FOLDERS_DRIVE_ID is empty).";
  const pdf = await callAppsScriptOrThrow<{ name?: string; data: string; inTree?: boolean }>(
    { action: "getDriveFilePdf", id, rootId },
    { timeoutMs: limits().fetchMs, retry: false },
  );
  // Only an Apps Script deploy that checked the folder tree says so. An older one
  // ignores rootId, so its answer is refused rather than trusted.
  if (pdf.inTree !== true) return "Drive files can be read only once the Apps Script side is deployed.";
  const t = await textOf(new Uint8Array(Buffer.from(pdf.data, "base64")));
  return { name: String(pdf.name ?? ""), ...t };
}

async function fetchJobTread(cfg: PaveConfig, fileId: string): Promise<Omit<Read, "key"> | string> {
  const f = await getFileById(cfg, fileId);
  if (!f) return "JobTread has no file with that id.";
  if (f.type !== "application/pdf") {
    return `"${f.name}" is ${f.type || "not a PDF"}. Only PDFs can be read; give the link.`;
  }
  if (f.size > BYTES_MAX) return `"${f.name}" is over 20 MB.`;
  if (!isJobTreadFileUrl(f.url)) return "JobTread gave no download link for that file.";
  const res = await fetch(f.url, { signal: AbortSignal.timeout(limits().fetchMs) });
  if (!res.ok) throw new Error(`JobTread's file link answered ${res.status}.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > BYTES_MAX) return `"${f.name}" is over 20 MB.`;
  return { name: f.name, ...(await textOf(bytes)) };
}

/** The file's text, from `file_texts` when fresh, else fetched and kept. A string is why it can't be read. */
export async function readFileText(cfg: PaveConfig, src: FileSource): Promise<Read | string> {
  const driveId = src.drive ? driveIdFromLink(src.drive) : "";
  const jtId = String(src.jobtreadFileId ?? "").trim();
  if (!driveId && !/^[\w-]{6,40}$/.test(jtId)) return "Pass a Drive link or a JobTread file id.";
  const key = driveId ? `drive:${driveId}` : `jobtread:${jtId}`;

  await ensureDb();
  const [kept] = await db.select().from(fileTexts).where(eq(fileTexts.key, key)).limit(1);
  const fresh = kept && (!driveId || Date.now() - Date.parse(kept.readAt) < DRIVE_FRESH_MS);
  if (kept && fresh) return kept;

  const got = driveId ? await fetchDrive(driveId) : await fetchJobTread(cfg, jtId);
  if (typeof got === "string") return got;
  const values = { ...got, text: got.text.slice(0, TEXT_MAX), readAt: new Date().toISOString() };
  // A scan left unread is not kept: a later read with more time may read it.
  if (!values.text) return { key, ...values };
  await db
    .insert(fileTexts)
    .values({ key, ...values })
    .onConflictDoUpdate({ target: fileTexts.key, set: values });
  return { key, ...values };
}

/**
 * Pages of a file's text from `page` on, whole pages until CHUNK_CHARS. One
 * page longer than that is cut. `nextPage` is where to go on; 0 at the end.
 */
export function pagesFrom(text: string, pages: number, page: number) {
  const start = Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, pages));
  const out: string[] = [];
  let used = 0;
  let p = start;
  for (; p <= pages; p++) {
    const t = pageText(text, p);
    const block = `[Page ${p}]\n${t || "(no text on this page)"}`;
    if (out.length && used + block.length > CHUNK_CHARS) break;
    out.push(block.slice(0, CHUNK_CHARS));
    used += block.length;
  }
  return { fromPage: start, toPage: p - 1, nextPage: p <= pages ? p : 0, text: out.join("\n\n") };
}

/** What the read_file tool hands back. */
export async function readFile(cfg: PaveConfig, src: FileSource, opts: { page?: number; words?: string[] } = {}) {
  const r = await readFileText(cfg, src);
  if (typeof r === "string") return { error: r };
  const head = { name: r.name, pages: r.pages, ...(r.note ? { note: r.note } : {}) };
  if (!r.text) return { ...head, error: r.note || "The file has no text." };
  const words = (opts.words ?? []).map((w) => w.toLowerCase()).filter(Boolean);
  if (words.length && !opts.page) {
    const { hits, snippets } = findSnippets(r.text, words, 12);
    return { ...head, hits, snippets, hint: "Read a page in full with page set to its number." };
  }
  return { ...head, ...pagesFrom(r.text, r.pages, opts.page ?? 1) };
}
